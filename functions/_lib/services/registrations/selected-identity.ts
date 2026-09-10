import { MEMBER_ELIGIBLE_USER_SELECT } from "../../auth/identity-capacities";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";

interface SelectedIdentityRow {
  id: string;
  user_id: string;
  organization_name: string | null;
  job_title: string | null;
}

/** Existing, active capacity only: selecting an identity creates no participation. */
export async function selectRegistrationIdentity(db: DatabaseLike, userId: string, identityId: string) {
  const row = await first<SelectedIdentityRow>(
    db,
    `SELECT identity.id, identity.user_id,
    eligible.organization_name, identity.job_title
    FROM (${MEMBER_ELIGIBLE_USER_SELECT}) eligible
    JOIN identities identity ON identity.id = eligible.identity_id
    WHERE eligible.id = ? AND eligible.identity_id = ? AND eligible.active = 1`,
    [userId, identityId],
  );
  if (!row) throw new AppError(403, "REGISTRATION_IDENTITY_UNAVAILABLE", "Choose one of your active identities.");
  return { id: row.id, userId: row.user_id, organizationName: row.organization_name, jobTitle: row.job_title };
}

export function prepareSelectedRegistrationIdentityGuard(
  db: DatabaseLike,
  identity: Awaited<ReturnType<typeof selectRegistrationIdentity>>,
  sessionId?: string,
  email?: string,
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM (${MEMBER_ELIGIBLE_USER_SELECT}) eligible
      JOIN identities identity ON identity.id = eligible.identity_id
      WHERE eligible.id = ? AND eligible.identity_id = ? AND eligible.active = 1
        AND eligible.organization_name IS ? AND identity.job_title IS ?
        ${email ? `AND EXISTS (SELECT 1 FROM users owner WHERE owner.id = eligible.id AND owner.normalized_email = ?)` : ""}
        ${
          sessionId
            ? `AND EXISTS (SELECT 1 FROM sessions session WHERE session.id = ?
          AND session.user_id = eligible.id AND session.revoked_at IS NULL
          AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
            : ""
        }`,
    bindings: [
      identity.userId,
      identity.id,
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
