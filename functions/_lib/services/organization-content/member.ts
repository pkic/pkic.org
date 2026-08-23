import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import {
  ORGANIZATION_CONTENT_SELECT_COLUMNS,
  toOrganizationExtendedContent,
  toOrganizationSummaryContent,
  type OrganizationContentRow,
} from "./fields";
import {
  CONTENT_REVIEW_FIELDS,
  REVIEW_COLUMNS,
  fetchPendingReview,
  isPendingReviewUniqueConflict,
  isStaleContentReviewTransition,
  prepareReviewTransitionGuard,
  requireOrgContact,
  toReviewSummary,
  type ContentReviewFieldInput,
  type ReviewRow,
} from "./model";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { prepareOrganizationContentReviewNotificationIntents } from "./notifications";
import type { MyOrganizationReviewsListQuery } from "../../../../assets/shared/schemas/me";

export async function getMyOrganizationProfile(db: DatabaseLike, member: AuthMember) {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }

  const row = await first<OrganizationContentRow & { name: string }>(
    db,
    `SELECT name, ${ORGANIZATION_CONTENT_SELECT_COLUMNS}
     FROM organizations WHERE id = ?`,
    [member.organizationId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const [pendingReview, holders, nomination] = await Promise.all([
    fetchPendingReview(db, member.organizationId),
    resolveRepresentativeRoleHolders(db, member.memberId),
    first<{ nominated_user_id: string }>(
      db,
      "SELECT nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
      [member.memberId],
    ),
  ]);

  return {
    id: row.id,
    name: row.name,
    ...toOrganizationSummaryContent(row),
    ...toOrganizationExtendedContent(row),
    isOrgContact: member.userId === holders.primaryContactUserId || member.userId === holders.secondaryContactUserId,
    isPrimaryContact: member.userId === holders.primaryContactUserId,
    pendingSecondaryContactUserId: nomination?.nominated_user_id ?? null,
    votingDelegateUserId: holders.votingDelegateUserId,
    pendingReview: pendingReview ? toReviewSummary(pendingReview) : null,
  };
}

export interface SubmitContentChangeResult {
  review: ReturnType<typeof toReviewSummary>;
  organizationName: string;
}

export async function submitOrgContentChange(
  db: DatabaseLike,
  member: AuthMember,
  input: ContentReviewFieldInput,
  reviewUrl: string,
): Promise<SubmitContentChangeResult> {
  const org = await requireOrgContact(db, member);
  if (await fetchPendingReview(db, org.id)) {
    throw new AppError(
      409,
      "REVIEW_ALREADY_PENDING",
      "A content submission is already pending review — withdraw it before submitting a revision",
    );
  }

  const changedFields = Object.fromEntries(Object.entries(input).filter(([key]) => key in CONTENT_REVIEW_FIELDS));
  if (Object.keys(changedFields).length === 0) {
    throw new AppError(422, "NO_CHANGES", "No editable fields were submitted");
  }

  const now = nowIso();
  const id = uuid();
  const proposedChangesJson = JSON.stringify(changedFields);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO organization_content_reviews
             (id, organization_id, submitted_by_user_id, proposed_changes_json, logo_staging_r2_key, status, submitted_at, created_at)
           VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)`,
        )
        .bind(id, org.id, member.userId, proposedChangesJson, now, now),
      prepareOrganizationContentReviewNotificationIntents(db, id, org.id, member.email, reviewUrl, now),
    ]);
  } catch (error) {
    if (!isPendingReviewUniqueConflict(error)) throw error;
    throw new AppError(
      409,
      "REVIEW_ALREADY_PENDING",
      "A content submission is already pending review — withdraw it before submitting a revision",
    );
  }

  const review: ReviewRow = {
    id,
    organization_id: org.id,
    submitted_by_user_id: member.userId,
    proposed_changes_json: proposedChangesJson,
    logo_staging_r2_key: null,
    status: "pending",
    reviewer_user_id: null,
    reviewer_note: null,
    submitted_at: now,
    reviewed_at: null,
    transition_revision: 0,
    created_at: now,
  };
  return { review: toReviewSummary(review), organizationName: org.name };
}

export async function listMyOrganizationReviews(
  db: DatabaseLike,
  member: AuthMember,
  params: MyOrganizationReviewsListQuery,
) {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const conditions = ["organization_id = ?"];
  const bindings: unknown[] = [member.organizationId];
  if (params.status === "history") {
    conditions.push("status <> 'pending'");
  } else {
    conditions.push("status = ?");
    bindings.push(params.status);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, ["status", "reviewer_note"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { submittedAt: "submitted_at", status: "status" },
    "submitted_at DESC",
    "id DESC",
  );
  const { rows, total } = await queryPage<ReviewRow>(db, {
    sql: `SELECT ${REVIEW_COLUMNS} FROM organization_content_reviews ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { reviews: rows.map(toReviewSummary), total };
}

export async function withdrawMyOrganizationReview(db: DatabaseLike, member: AuthMember, reviewId: string) {
  const org = await requireOrgContact(db, member);
  const review = await first<ReviewRow>(db, `SELECT ${REVIEW_COLUMNS} FROM organization_content_reviews WHERE id = ?`, [
    reviewId,
  ]);
  if (!review || review.organization_id !== org.id) throw new AppError(404, "NOT_FOUND", "Review not found");
  if (review.status !== "pending") {
    throw new AppError(409, "NOT_PENDING", "Only a pending review can be withdrawn");
  }

  try {
    const statements = [
      prepareReviewTransitionGuard(db, review),
      db
        .prepare("UPDATE organization_content_reviews SET status = 'withdrawn' WHERE id = ? AND status = 'pending'")
        .bind(reviewId),
      db
        .prepare("UPDATE organizations SET logo_staging_r2_key = NULL WHERE id = ? AND logo_staging_r2_key = ?")
        .bind(org.id, review.logo_staging_r2_key),
    ];
    const deletion = prepareStorageDeletion(db, review.logo_staging_r2_key, nowIso(), "assets");
    if (deletion) statements.push(deletion);
    await db.batch(statements);
  } catch (error) {
    if (!isStaleContentReviewTransition(error)) throw error;
    throw new AppError(409, "NOT_PENDING", "This review changed before it could be withdrawn");
  }

  return { id: reviewId, staleLogoStagingR2Key: review.logo_staging_r2_key };
}

export interface PreparedOrganizationLogoStage {
  previousStagingKey: string | null;
  statements: StatementLike[];
  mapCommitError(error: unknown): unknown;
}

/** Builds the atomic staging mutation after the caller has authorized the organization contact. */
export async function prepareAuthorizedOrganizationLogoStage(
  db: DatabaseLike,
  member: AuthMember,
  organizationId: string,
  r2Key: string,
  reviewUrl: string,
): Promise<PreparedOrganizationLogoStage> {
  const now = nowIso();
  const existingPending = await fetchPendingReview(db, organizationId);
  const previousStagingKey = existingPending?.logo_staging_r2_key ?? null;

  if (existingPending) {
    const statements = [
      prepareReviewTransitionGuard(db, existingPending),
      db
        .prepare("UPDATE organization_content_reviews SET logo_staging_r2_key = ? WHERE id = ? AND status = 'pending'")
        .bind(r2Key, existingPending.id),
      db
        .prepare("UPDATE organizations SET logo_staging_r2_key = ?, updated_at = ? WHERE id = ?")
        .bind(r2Key, now, organizationId),
    ];
    const deletion = prepareStorageDeletion(db, previousStagingKey, now, "assets");
    if (deletion) statements.push(deletion);
    return {
      previousStagingKey,
      statements,
      mapCommitError(error) {
        return isStaleContentReviewTransition(error)
          ? new AppError(409, "REVIEW_CHANGED", "The pending review changed; please retry the logo upload")
          : error;
      },
    };
  }

  const reviewId = uuid();
  return {
    previousStagingKey,
    statements: [
      db
        .prepare(
          `INSERT INTO organization_content_reviews
             (id, organization_id, submitted_by_user_id, proposed_changes_json, logo_staging_r2_key, status, submitted_at, created_at)
           VALUES (?, ?, ?, '{}', ?, 'pending', ?, ?)`,
        )
        .bind(reviewId, organizationId, member.userId, r2Key, now, now),
      db
        .prepare("UPDATE organizations SET logo_staging_r2_key = ?, updated_at = ? WHERE id = ?")
        .bind(r2Key, now, organizationId),
      prepareOrganizationContentReviewNotificationIntents(db, reviewId, organizationId, member.email, reviewUrl, now),
    ],
    mapCommitError(error) {
      return isPendingReviewUniqueConflict(error)
        ? new AppError(409, "REVIEW_CHANGED", "A pending review was created; please retry the logo upload")
        : error;
    },
  };
}
