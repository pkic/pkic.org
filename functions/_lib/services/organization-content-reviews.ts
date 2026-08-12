/**
 * Organization content moderation workflow (*workflow* half —
 * the data-bearing columns this reads/writes were pulled forward by
 * migration 0037; see admin-organizations.ts's own header for that split).
 *
 * Only the organization's primary or secondary contact (organizations.
 * primary_contact_user_id / secondary_contact_user_id) may submit a content
 * change; all other representatives see the org profile as read-only, per
 * A submission never touches the live `organizations` row directly —
 * it's held in `organization_content_reviews` until a staff admin with
 * `organizations:content-review` approves or rejects it. Logo changes ride
 * the same queue via `logo_staging_r2_key`.
 *
 * Does not call queueEmail directly — same DB-only/route-owns-email split
 * every other service in this codebase uses (see membership-onboarding.ts's
 * header note). R2 object writes/deletes are likewise left to the route
 * handlers, which have access to `c.env`/`c.executionCtx`; this file only
 * ever stores/reads R2 *keys*.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseJsonSafe } from "../utils/json";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/api";
import { AppError } from "../errors";
import type { AuthAdmin, AuthMember, DatabaseLike } from "../types";

/** camelCase field -> organizations column. Deliberately excludes `name`,
 * `organizationDomains`, `memberType`/`memberSince`/`sponsor.level` —
 * lists those as admin-only, not submittable through this workflow. */
export const CONTENT_REVIEW_FIELDS: Record<string, string> = {
  slogan: "slogan",
  description: "description",
  contentMarkdown: "content_markdown",
  website: "website",
  blogUrl: "blog_url",
  blogFeedUrl: "blog_feed_url",
  pressUrl: "press_url",
  pressFeedUrl: "press_feed_url",
  careersUrl: "careers_url",
  links: "links_json",
};

/** proposed_changes_json stores `links` as a plain string[] (not the
 * serialized links_json string) — matching the shape myOrganizationContentChangeSchema
 * accepts and what the admin diff viewer compares against parsed current links. */
export interface ContentReviewFieldInput {
  slogan?: string | null;
  description?: string | null;
  contentMarkdown?: string | null;
  website?: string | null;
  blogUrl?: string | null;
  blogFeedUrl?: string | null;
  pressUrl?: string | null;
  pressFeedUrl?: string | null;
  careersUrl?: string | null;
  links?: string[];
}

interface OrgContactRow {
  id: string;
  name: string;
  primary_contact_user_id: string | null;
  secondary_contact_user_id: string | null;
}

export async function requireOrgContact(db: DatabaseLike, member: AuthMember): Promise<OrgContactRow> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const org = await first<OrgContactRow>(
    db,
    "SELECT id, name, primary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
    [member.organizationId],
  );
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const isContact = member.userId === org.primary_contact_user_id || member.userId === org.secondary_contact_user_id;
  if (!isContact) {
    throw new AppError(
      403,
      "NOT_ORG_CONTACT",
      "Only your organization's primary or secondary contact can manage the organization profile",
    );
  }
  return org;
}

interface ReviewRow {
  id: string;
  organization_id: string;
  submitted_by_user_id: string;
  proposed_changes_json: string;
  logo_staging_r2_key: string | null;
  status: string;
  reviewer_user_id: string | null;
  reviewer_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  created_at: string;
}

function toReviewSummary(row: ReviewRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    submittedByUserId: row.submitted_by_user_id,
    proposedChanges: parseJsonSafe<Record<string, unknown>>(row.proposed_changes_json, {}),
    hasLogoChange: Boolean(row.logo_staging_r2_key),
    status: row.status,
    reviewerUserId: row.reviewer_user_id,
    reviewerNote: row.reviewer_note,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  };
}

async function fetchPendingReview(db: DatabaseLike, organizationId: string): Promise<ReviewRow | null> {
  return first<ReviewRow>(
    db,
    "SELECT * FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending'",
    [organizationId],
  );
}

// ── Member self-service ─────────────────────────────────────────────────

export async function getMyOrganizationProfile(db: DatabaseLike, member: AuthMember) {
  // GET is allowed for any org-tied member (read-only for non-contacts) —
  // only content *submission* is contact-restricted, checked separately by
  // requireOrgContact in the write paths below.
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }

  const row = await first<Record<string, unknown>>(
    db,
    `SELECT id, name, description, website, content_markdown, slogan, logo_r2_key,
            blog_url, blog_feed_url, press_url, press_feed_url, careers_url, links_json,
            primary_contact_user_id, secondary_contact_user_id, pending_secondary_contact_user_id,
            voting_delegate_user_id
     FROM organizations WHERE id = ?`,
    [member.organizationId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const pendingReview = await fetchPendingReview(db, member.organizationId as string);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    website: row.website,
    contentMarkdown: row.content_markdown,
    slogan: row.slogan,
    logoUrl: row.logo_r2_key ? `/api/v1/members/${row.id}/logo` : null,
    blogUrl: row.blog_url,
    blogFeedUrl: row.blog_feed_url,
    pressUrl: row.press_url,
    pressFeedUrl: row.press_feed_url,
    careersUrl: row.careers_url,
    links: parseLinksJson(row.links_json as string | null),
    isOrgContact: member.userId === row.primary_contact_user_id || member.userId === row.secondary_contact_user_id,
    isPrimaryContact: member.userId === row.primary_contact_user_id,
    pendingSecondaryContactUserId: row.pending_secondary_contact_user_id,
    votingDelegateUserId: row.voting_delegate_user_id,
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
): Promise<SubmitContentChangeResult> {
  const org = await requireOrgContact(db, member);

  const existingPending = await fetchPendingReview(db, org.id);
  if (existingPending) {
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
  await run(
    db,
    `INSERT INTO organization_content_reviews
       (id, organization_id, submitted_by_user_id, proposed_changes_json, logo_staging_r2_key, status, submitted_at, created_at)
     VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)`,
    [id, org.id, member.userId, JSON.stringify(changedFields), now, now],
  );

  const review = await first<ReviewRow>(db, "SELECT * FROM organization_content_reviews WHERE id = ?", [id]);
  return { review: toReviewSummary(review as ReviewRow), organizationName: org.name };
}

export async function listMyOrganizationReviews(db: DatabaseLike, member: AuthMember) {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const rows = await all<ReviewRow>(
    db,
    "SELECT * FROM organization_content_reviews WHERE organization_id = ? ORDER BY submitted_at DESC",
    [member.organizationId],
  );
  return rows.map(toReviewSummary);
}

export async function withdrawMyOrganizationReview(db: DatabaseLike, member: AuthMember, reviewId: string) {
  const org = await requireOrgContact(db, member);
  const review = await first<ReviewRow>(db, "SELECT * FROM organization_content_reviews WHERE id = ?", [reviewId]);
  if (!review || review.organization_id !== org.id) throw new AppError(404, "NOT_FOUND", "Review not found");
  if (review.status !== "pending") {
    throw new AppError(409, "NOT_PENDING", "Only a pending review can be withdrawn");
  }

  await run(db, "UPDATE organization_content_reviews SET status = 'withdrawn' WHERE id = ?", [reviewId]);

  if (review.logo_staging_r2_key) {
    await run(db, "UPDATE organizations SET logo_staging_r2_key = NULL WHERE id = ? AND logo_staging_r2_key = ?", [
      org.id,
      review.logo_staging_r2_key,
    ]);
  }

  return { id: reviewId, staleLogoStagingR2Key: review.logo_staging_r2_key };
}

/**
 * Stages a proposed logo, folding it into the org's single pending review
 * (creating one with no other field changes if none exists yet):
 * "Logo changes follow the same moderation queue." Returns the previous
 * staged key (if any) so the route can clean it up in R2.
 */
export async function stageOrganizationLogo(db: DatabaseLike, member: AuthMember, r2Key: string) {
  const org = await requireOrgContact(db, member);
  const now = nowIso();

  const existingPending = await fetchPendingReview(db, org.id);
  const previousStagingKey = existingPending?.logo_staging_r2_key ?? null;

  if (existingPending) {
    await run(db, "UPDATE organization_content_reviews SET logo_staging_r2_key = ? WHERE id = ?", [
      r2Key,
      existingPending.id,
    ]);
  } else {
    await run(
      db,
      `INSERT INTO organization_content_reviews
         (id, organization_id, submitted_by_user_id, proposed_changes_json, logo_staging_r2_key, status, submitted_at, created_at)
       VALUES (?, ?, ?, '{}', ?, 'pending', ?, ?)`,
      [uuid(), org.id, member.userId, r2Key, now, now],
    );
  }

  await run(db, "UPDATE organizations SET logo_staging_r2_key = ?, updated_at = ? WHERE id = ?", [r2Key, now, org.id]);

  return { previousStagingKey };
}

// ── Staff admin moderation ──────────────────────────────────────────────

interface AdminReviewRow extends ReviewRow {
  organization_name: string;
  submitter_first_name: string | null;
  submitter_last_name: string | null;
  submitter_email: string;
}

const ADMIN_REVIEW_SELECT = `
  SELECT r.*, o.name AS organization_name,
         u.first_name AS submitter_first_name, u.last_name AS submitter_last_name, u.email AS submitter_email
  FROM organization_content_reviews r
  JOIN organizations o ON o.id = r.organization_id
  JOIN users u ON u.id = r.submitted_by_user_id
`;

function toAdminReviewSummary(row: AdminReviewRow) {
  return {
    ...toReviewSummary(row),
    organizationName: row.organization_name,
    submitterName: [row.submitter_first_name, row.submitter_last_name].filter(Boolean).join(" ") || row.submitter_email,
    submitterEmail: row.submitter_email,
  };
}

export async function listContentReviews(db: DatabaseLike, params: { status?: string; limit: number; offset: number }) {
  const status = params.status ?? "pending";
  const rows = await all<AdminReviewRow>(
    db,
    `${ADMIN_REVIEW_SELECT} WHERE r.status = ? ORDER BY r.submitted_at ASC LIMIT ? OFFSET ?`,
    [status, params.limit, params.offset],
  );
  const totalRow = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM organization_content_reviews WHERE status = ?",
    [status],
  );
  return { reviews: rows.map(toAdminReviewSummary), total: totalRow?.total ?? 0 };
}

export async function getContentReviewDetail(db: DatabaseLike, reviewId: string) {
  const row = await first<AdminReviewRow>(db, `${ADMIN_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
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
    ...toAdminReviewSummary(row),
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
  /** Only set on approval when a logo change was included — the route promotes the R2 object. */
  promotedLogoR2Key: string | null;
  /** The organization's previous live logo key, to delete from R2 after promotion (approval only). */
  previousLiveLogoR2Key: string | null;
}

export async function approveContentReview(
  db: DatabaseLike,
  reviewId: string,
  admin: AuthAdmin,
): Promise<ContentReviewDecisionResult> {
  const row = await first<AdminReviewRow>(db, `${ADMIN_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
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
    values.push(field === "links" ? serializeLinks(value as string[]) : value);
  }

  const now = nowIso();
  if (row.logo_staging_r2_key) {
    setClauses.push("logo_r2_key = ?");
    values.push(row.logo_staging_r2_key);
  }
  setClauses.push("logo_staging_r2_key = NULL", "updated_at = ?");
  values.push(now, row.organization_id);

  await db.batch([
    db.prepare(`UPDATE organizations SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
    db
      .prepare(
        `UPDATE organization_content_reviews SET status = 'approved', reviewer_user_id = ?, reviewed_at = ? WHERE id = ?`,
      )
      .bind(admin.id, now, reviewId),
  ]);

  return {
    review: toReviewSummary({ ...row, status: "approved", reviewer_user_id: admin.id, reviewed_at: now }),
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    submitterEmail: row.submitter_email,
    submitterName: [row.submitter_first_name, row.submitter_last_name].filter(Boolean).join(" ") || row.submitter_email,
    promotedLogoR2Key: row.logo_staging_r2_key,
    previousLiveLogoR2Key: row.logo_staging_r2_key ? (orgRow?.logo_r2_key ?? null) : null,
  };
}

export interface ContentReviewRejectResult {
  review: ReturnType<typeof toReviewSummary>;
  organizationName: string;
  submitterEmail: string;
  submitterName: string;
  /** Staged R2 key to delete, if this submission included a logo change. */
  staleLogoStagingR2Key: string | null;
}

export async function rejectContentReview(
  db: DatabaseLike,
  reviewId: string,
  admin: AuthAdmin,
  reviewerNote: string,
): Promise<ContentReviewRejectResult> {
  const row = await first<AdminReviewRow>(db, `${ADMIN_REVIEW_SELECT} WHERE r.id = ?`, [reviewId]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Review not found");
  if (row.status !== "pending") throw new AppError(409, "NOT_PENDING", "Only a pending review can be rejected");

  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE organization_content_reviews SET status = 'rejected', reviewer_user_id = ?, reviewer_note = ?, reviewed_at = ? WHERE id = ?`,
      )
      .bind(admin.id, reviewerNote, now, reviewId),
    db
      .prepare("UPDATE organizations SET logo_staging_r2_key = NULL WHERE id = ? AND logo_staging_r2_key = ?")
      .bind(row.organization_id, row.logo_staging_r2_key),
  ]);

  return {
    review: toReviewSummary({
      ...row,
      status: "rejected",
      reviewer_user_id: admin.id,
      reviewer_note: reviewerNote,
      reviewed_at: now,
    }),
    organizationName: row.organization_name,
    submitterEmail: row.submitter_email,
    submitterName: [row.submitter_first_name, row.submitter_last_name].filter(Boolean).join(" ") || row.submitter_email,
    staleLogoStagingR2Key: row.logo_staging_r2_key,
  };
}
