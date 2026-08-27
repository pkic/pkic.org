import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { prepareAuditLog } from "../audit";
import {
  CONTENT_REVIEW_FIELDS,
  isStaleContentReviewTransition,
  prepareReviewTransitionGuard,
  toReviewSummary,
  type ReviewRow,
} from "./model";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { prepareStorageDeletion } from "../storage-deletion-outbox";
import { serializeOrganizationContentValue } from "./fields";
import type { OrganizationContentReviewsListQuery } from "../../../../assets/shared/schemas/organization-content-reviews";

interface ContentReviewRow extends ReviewRow {
  organization_name: string;
  submitter_first_name: string | null;
  submitter_last_name: string | null;
  submitter_email: string;
}

const CONTENT_REVIEW_SELECT = `
  SELECT r.id, r.organization_id, r.submitted_by_user_id, r.proposed_changes_json,
         r.logo_staging_r2_key, r.status, r.reviewer_user_id, r.reviewer_note,
         r.submitted_at, r.reviewed_at, r.transition_revision, r.created_at,
         o.name AS organization_name,
         u.first_name AS submitter_first_name, u.last_name AS submitter_last_name, u.email AS submitter_email
  FROM organization_content_reviews r
  JOIN organizations o ON o.id = r.organization_id
  JOIN users u ON u.id = r.submitted_by_user_id
`;

function submitterName(row: ContentReviewRow): string {
  return [row.submitter_first_name, row.submitter_last_name].filter(Boolean).join(" ") || row.submitter_email;
}

function toContentReviewSummary(row: ContentReviewRow) {
  return {
    ...toReviewSummary(row),
    organizationName: row.organization_name,
    submitterName: submitterName(row),
    submitterEmail: row.submitter_email,
  };
}

export async function listContentReviews(db: DatabaseLike, params: OrganizationContentReviewsListQuery) {
  const status = params.status ?? "pending";
  const conditions = ["r.status = ?"];
  const bindings: unknown[] = [status];
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "o.name",
      "u.email",
      "u.first_name",
      "u.last_name",
      "r.status",
      "r.reviewer_note",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      organizationName: "o.name COLLATE NOCASE",
      submitterName:
        "LOWER(COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email))",
      status: "r.status",
      submittedAt: "r.submitted_at",
    },
    "r.submitted_at ASC",
    "r.id ASC",
  );
  const { rows, total } = await queryPage<ContentReviewRow>(db, {
    sql: `${CONTENT_REVIEW_SELECT} ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { reviews: rows.map(toContentReviewSummary), total };
}

export async function getContentReviewDetail(db: DatabaseLike, reviewId: string) {
  const row = await first<ContentReviewRow>(db, `${CONTENT_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Review not found");

  const orgRow = await first<Record<string, unknown>>(
    db,
    `SELECT description, website, content_markdown, slogan, logo_r2_key,
            blog_url, blog_feed_url, press_url, press_feed_url, careers_url, links_json
     FROM organizations WHERE id = ?`,
    [row.organization_id],
  );
  const proposed = parseJsonSafe<Record<string, unknown>>(row.proposed_changes_json, {});
  const diff = Object.keys(CONTENT_REVIEW_FIELDS)
    .filter((field) => field in proposed)
    .map((field) => ({
      field,
      current:
        field === "links"
          ? parseLinksJson(orgRow?.links_json as string | null)
          : (orgRow?.[CONTENT_REVIEW_FIELDS[field]] ?? null),
      proposed: proposed[field],
    }));

  return {
    ...toContentReviewSummary(row),
    diff,
    hasLogoChange: Boolean(row.logo_staging_r2_key),
    logoStagingR2Key: row.logo_staging_r2_key,
    currentLogoR2Key: orgRow?.logo_r2_key ?? null,
  };
}

export interface ContentReviewDecisionResult {
  review: ReturnType<typeof toReviewSummary>;
  organizationId: string;
  organizationName: string;
  submitterEmail: string;
  submitterName: string;
  promotedLogoR2Key: string | null;
  previousLiveLogoR2Key: string | null;
  outboxId: string;
}

export async function approveContentReview(
  db: DatabaseLike,
  reviewId: string,
  reviewer: UserBackedAuthAdmin,
): Promise<ContentReviewDecisionResult> {
  const row = await first<ContentReviewRow>(db, `${CONTENT_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Review not found");
  if (row.status !== "pending") throw new AppError(409, "NOT_PENDING", "Only a pending review can be approved");

  const orgRow = await first<{ logo_r2_key: string | null }>(db, "SELECT logo_r2_key FROM organizations WHERE id = ?", [
    row.organization_id,
  ]);
  const proposed = parseJsonSafe<Record<string, unknown>>(row.proposed_changes_json, {});
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [field, value] of Object.entries(proposed)) {
    const column = CONTENT_REVIEW_FIELDS[field];
    if (!column) continue;
    setClauses.push(`${column} = ?`);
    values.push(serializeOrganizationContentValue(field, value));
  }

  const now = nowIso();
  const reviewerUserId = reviewer.id;
  if (row.logo_staging_r2_key) {
    setClauses.push("logo_r2_key = ?");
    values.push(row.logo_staging_r2_key);
  }
  setClauses.push("logo_staging_r2_key = NULL", "updated_at = ?");
  values.push(now, row.organization_id);
  const queued = prepareQueueEmailStatement(
    db,
    {
      templateKey: "org-content-approved",
      recipientEmail: row.submitter_email,
      messageType: "transactional",
      subject: "Your organization profile update was approved",
      data: { contactName: submitterName(row), organizationName: row.organization_name },
    },
    now,
  );

  try {
    const statements = [
      prepareReviewTransitionGuard(db, row),
      db.prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
      db
        .prepare(
          `UPDATE organization_content_reviews
           SET status = 'approved', reviewer_user_id = ?, reviewed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(reviewerUserId, now, reviewId),
      queued.statement,
      prepareAuditLog(
        db,
        "admin",
        reviewer.id,
        "organization_content_review_approved",
        "organization",
        row.organization_id,
        { reviewId },
        now,
      ),
    ];
    const deletion = prepareStorageDeletion(
      db,
      row.logo_staging_r2_key ? (orgRow?.logo_r2_key ?? null) : null,
      now,
      "assets",
    );
    if (deletion) statements.push(deletion);
    await db.batch(statements);
  } catch (error) {
    if (!isStaleContentReviewTransition(error)) throw error;
    throw new AppError(409, "NOT_PENDING", "This review changed before it could be approved");
  }

  return {
    review: toReviewSummary({ ...row, status: "approved", reviewer_user_id: reviewerUserId, reviewed_at: now }),
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    submitterEmail: row.submitter_email,
    submitterName: submitterName(row),
    promotedLogoR2Key: row.logo_staging_r2_key,
    previousLiveLogoR2Key: row.logo_staging_r2_key ? (orgRow?.logo_r2_key ?? null) : null,
    outboxId: queued.id,
  };
}

export interface ContentReviewRejectResult {
  review: ReturnType<typeof toReviewSummary>;
  organizationName: string;
  submitterEmail: string;
  submitterName: string;
  staleLogoStagingR2Key: string | null;
  outboxId: string;
}

export async function rejectContentReview(
  db: DatabaseLike,
  reviewId: string,
  reviewer: UserBackedAuthAdmin,
  reviewerNote: string,
): Promise<ContentReviewRejectResult> {
  const row = await first<ContentReviewRow>(db, `${CONTENT_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Review not found");
  if (row.status !== "pending") throw new AppError(409, "NOT_PENDING", "Only a pending review can be rejected");

  const now = nowIso();
  const reviewerUserId = reviewer.id;
  const queued = prepareQueueEmailStatement(
    db,
    {
      templateKey: "org-content-rejected",
      recipientEmail: row.submitter_email,
      messageType: "transactional",
      subject: "Your organization profile update was not approved",
      data: { contactName: submitterName(row), organizationName: row.organization_name, reviewerNote },
    },
    now,
  );
  try {
    const statements = [
      prepareReviewTransitionGuard(db, row),
      db
        .prepare(
          `UPDATE organization_content_reviews
           SET status = 'rejected', reviewer_user_id = ?, reviewer_note = ?, reviewed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(reviewerUserId, reviewerNote, now, reviewId),
      db
        .prepare("UPDATE organizations SET logo_staging_r2_key = NULL WHERE id = ? AND logo_staging_r2_key = ?")
        .bind(row.organization_id, row.logo_staging_r2_key),
      queued.statement,
      prepareAuditLog(
        db,
        "admin",
        reviewer.id,
        "organization_content_review_rejected",
        "organization_content_review",
        reviewId,
        { reviewerNote },
        now,
      ),
    ];
    const deletion = prepareStorageDeletion(db, row.logo_staging_r2_key, now, "assets");
    if (deletion) statements.push(deletion);
    await db.batch(statements);
  } catch (error) {
    if (!isStaleContentReviewTransition(error)) throw error;
    throw new AppError(409, "NOT_PENDING", "This review changed before it could be rejected");
  }

  return {
    review: toReviewSummary({
      ...row,
      status: "rejected",
      reviewer_user_id: reviewerUserId,
      reviewer_note: reviewerNote,
      reviewed_at: now,
    }),
    organizationName: row.organization_name,
    submitterEmail: row.submitter_email,
    submitterName: submitterName(row),
    staleLogoStagingR2Key: row.logo_staging_r2_key,
    outboxId: queued.id,
  };
}
