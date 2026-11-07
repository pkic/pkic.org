import {
  identityJobTitleSql,
  identityOrganizationNameSql,
  selectedOrAffiliationJobTitleSql,
  selectedOrAffiliationOrganizationNameSql,
} from "../identities/affiliation-projection";
import { ownedIdentityLifecycleSql } from "../identities/selection";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { workEmailDomain } from "../../email-domains/classification";

/** A verified organization address needs an organization representation before registering. */
export function requireRegistrationWorkRepresentation(input: {
  email: string;
  verified: boolean;
  organizationId?: string | null;
  organizationContextToken?: string;
  organizationIdSubmitted?: boolean;
}) {
  if (input.organizationIdSubmitted && !input.organizationContextToken)
    throw new AppError(409, "IDENTITY_CONTEXT_REQUIRED", "Confirm your organization details again before registering.");
  if (input.verified && workEmailDomain(input.email) && !input.organizationId && !input.organizationContextToken)
    throw new AppError(
      422,
      "REGISTRATION_REPRESENTATION_REQUIRED",
      "Choose your organization representation for this work email before registering.",
    );
}

interface SelectedIdentityRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
}

/** Owned representation only: selecting an identity creates no membership or capacity. */
export async function selectRegistrationIdentity(db: DatabaseLike, userId: string, identityId: string) {
  const row = await first<SelectedIdentityRow>(
    db,
    `SELECT identity.id, identity.user_id, identity.organization_id,
    organization.name AS organization_name, identity.job_title
    FROM identities identity
    JOIN users owner ON owner.id = identity.user_id
    LEFT JOIN organizations organization ON organization.id = identity.organization_id
    WHERE owner.id = ? AND identity.id = ? AND owner.active = 1
      AND owner.pii_redacted_at IS NULL AND owner.merged_into_user_id IS NULL
      AND ${ownedIdentityLifecycleSql("identity", "strftime('%Y-%m-%dT%H:%M:%fZ','now')")}`,
    [userId, identityId],
  );
  if (!row) throw new AppError(403, "REGISTRATION_IDENTITY_UNAVAILABLE", "Choose one of your active identities.");
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    jobTitle: row.job_title,
  };
}

export function prepareSelectedRegistrationIdentityGuard(
  db: DatabaseLike,
  identity: Awaited<ReturnType<typeof selectRegistrationIdentity>>,
  sessionId?: string,
  email?: string,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM identities identity
      JOIN users owner ON owner.id = identity.user_id
      LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE owner.id = ? AND identity.id = ? AND owner.active = 1
        AND owner.pii_redacted_at IS NULL AND owner.merged_into_user_id IS NULL
        AND ${ownedIdentityLifecycleSql("identity", "strftime('%Y-%m-%dT%H:%M:%fZ','now')")}
        AND identity.organization_id IS ? AND organization.name IS ? AND identity.job_title IS ?
        ${email ? "AND owner.normalized_email = ?" : ""}
        ${
          sessionId
            ? `AND EXISTS (SELECT 1 FROM sessions session WHERE session.id = ?
          AND session.user_id = owner.id AND session.revoked_at IS NULL
          AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
            : ""
        }`,
    bindings: [
      identity.userId,
      identity.id,
      identity.organizationId,
      identity.organizationName,
      identity.jobTitle,
      ...(email ? [email] : []),
      ...(sessionId ? [sessionId] : []),
    ],
  });
}

/**
 * A registration shows the identity it was made as; one made without an
 * identity shows the person's current affiliation. Display callers may include
 * existing submitted review details while the PKIC organization link is pending.
 * The default remains identity-only for affiliation filters and eligibility.
 */
export function registrationOrganizationSql(
  registration: "r" | "source_registration" | "reg",
  includePendingReview = false,
): string {
  const selected = selectedOrAffiliationOrganizationNameSql(
    `${registration}.registration_identity_id`,
    `${registration}.user_id`,
  );
  return reviewedRegistrationProjection(
    registration,
    selected,
    identityOrganizationNameSql,
    includePendingReview ? "organization_name" : null,
  );
}
export function registrationJobTitleSql(
  registration: "r" | "source_registration" | "reg",
  includePendingReview = false,
): string {
  const selected = selectedOrAffiliationJobTitleSql(
    `${registration}.registration_identity_id`,
    `${registration}.user_id`,
  );
  return reviewedRegistrationProjection(
    registration,
    selected,
    identityJobTitleSql,
    includePendingReview ? "job_title" : null,
  );
}

/** A review is attribution evidence; never substitute an unrelated current affiliation while it is pending. */
function reviewedRegistrationProjection(
  registration: "r" | "source_registration" | "reg",
  selected: string,
  identityValue: (id: string) => string,
  pendingReviewColumn: "organization_name" | "job_title" | null,
): string {
  const review = `(SELECT resolved_identity_id FROM affiliation_reviews WHERE source_type='registration' AND source_id=${registration}.id)`;
  // Submitted text is presentation only. Identity-based affiliation filters and
  // eligibility keep the default projection, which never treats review text as a link.
  const value = pendingReviewColumn
    ? `COALESCE(${identityValue(review)}, (SELECT ${pendingReviewColumn} FROM affiliation_reviews
        WHERE source_type='registration' AND source_id=${registration}.id AND user_id=${registration}.user_id
          AND resolved_at IS NULL AND resolved_identity_id IS NULL))`
    : identityValue(review);
  return `CASE WHEN ${registration}.registration_identity_id IS NULL AND EXISTS
    (SELECT 1 FROM affiliation_reviews WHERE source_type='registration' AND source_id=${registration}.id)
    THEN ${value} ELSE ${selected} END`;
}
export const REGISTRATION_ORGANIZATION_SQL = registrationOrganizationSql("r");
export const REGISTRATION_JOB_TITLE_SQL = registrationJobTitleSql("r");
/** Attendee-visible details may name a submitted organization before its PKIC link is approved. */
export const REGISTRATION_DISPLAY_ORGANIZATION_SQL = registrationOrganizationSql("r", true);
export const REGISTRATION_DISPLAY_JOB_TITLE_SQL = registrationJobTitleSql("r", true);

/**
 * The organization and title a registration about to be (or already) stored
 * shows: its selected identity, else the person's current affiliation. A
 * person created in the same batch has no identity yet and shows neither.
 */
export async function readRegistrationAffiliation(
  db: DatabaseLike,
  input: { identityId: string | null; userId: string },
): Promise<{ organizationName: string | null; jobTitle: string | null }> {
  const row = await first<{ organization_name: string | null; job_title: string | null }>(
    db,
    `SELECT ${selectedOrAffiliationOrganizationNameSql("?1", "?2")} AS organization_name,
            ${selectedOrAffiliationJobTitleSql("?1", "?2")} AS job_title`,
    [input.identityId, input.userId],
  );
  return { organizationName: row?.organization_name ?? null, jobTitle: row?.job_title ?? null };
}
