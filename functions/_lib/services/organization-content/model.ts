import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { uuid } from "../../utils/ids";
import { parseJsonSafe } from "../../utils/json";
import { resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import type { AuthMember, DatabaseLike, StatementLike } from "../../types";
import type { OrganizationEditableContent } from "../../../../assets/shared/schemas/organization-profile";
import { ORGANIZATION_CONTENT_COLUMN_BY_FIELD } from "./fields";

/** Public input field -> organizations column. Governance fields stay admin-only. */
export const CONTENT_REVIEW_FIELDS: Record<string, string> = ORGANIZATION_CONTENT_COLUMN_BY_FIELD;
export type ContentReviewFieldInput = OrganizationEditableContent;

export interface OrgContactRow {
  id: string;
  name: string;
}

export interface ReviewRow {
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
  transition_revision: number;
  created_at: string;
}

export const REVIEW_COLUMNS = `id, organization_id, submitted_by_user_id, proposed_changes_json,
  logo_staging_r2_key, status, reviewer_user_id, reviewer_note, submitted_at,
  reviewed_at, transition_revision, created_at`;

export async function requireOrgContact(db: DatabaseLike, member: AuthMember): Promise<OrgContactRow> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const org = await first<OrgContactRow>(db, "SELECT id, name FROM organizations WHERE id = ?", [
    member.organizationId,
  ]);
  if (!org) throw new AppError(404, "NOT_FOUND", "Organization not found");

  const holders = await resolveRepresentativeRoleHolders(db, member.memberId);
  const isContact = member.userId === holders.primaryContactUserId || member.userId === holders.secondaryContactUserId;
  if (!isContact) {
    throw new AppError(
      403,
      "NOT_ORG_CONTACT",
      "Only your organization's primary or secondary contact can manage the organization profile",
    );
  }
  return org;
}

export function prepareReviewTransitionGuard(db: DatabaseLike, review: ReviewRow): StatementLike {
  return db
    .prepare(
      `INSERT INTO organization_content_review_transition_guards (id, review_id, expected_revision)
       VALUES (?, ?, ?)`,
    )
    .bind(uuid(), review.id, review.transition_revision);
}

export function isStaleContentReviewTransition(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ORGANIZATION_CONTENT_REVIEW_CHANGED");
}

export function isPendingReviewUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("uq_org_content_reviews_one_pending") ||
      error.message.includes("UNIQUE constraint failed: organization_content_reviews.organization_id"))
  );
}

export function toReviewSummary(row: ReviewRow) {
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

export function fetchPendingReview(db: DatabaseLike, organizationId: string): Promise<ReviewRow | null> {
  return first<ReviewRow>(
    db,
    `SELECT ${REVIEW_COLUMNS} FROM organization_content_reviews WHERE organization_id = ? AND status = 'pending'`,
    [organizationId],
  );
}
