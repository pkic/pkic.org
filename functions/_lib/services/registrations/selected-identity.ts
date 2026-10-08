import { ownedIdentityLifecycleSql } from "../identities/selection";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";

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

/** The event keeps the details confirmed at registration, independently of later profile edits. */
export function registrationOrganizationSql(registration: "r" | "source_registration"): string {
  return `CASE WHEN ${registration}.registration_identity_id IS NOT NULL
    THEN ${registration}.registration_organization_name ELSE u.organization_name END`;
}
export const REGISTRATION_ORGANIZATION_SQL = registrationOrganizationSql("r");
export const REGISTRATION_JOB_TITLE_SQL = `CASE WHEN r.registration_identity_id IS NOT NULL
  THEN r.registration_job_title ELSE u.job_title END`;
