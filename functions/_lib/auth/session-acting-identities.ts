/** The identities a user session may act as, read from live identity state. */
import type { SessionActingIdentity } from "../../../assets/shared/session-acting-identity";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";

/** A person holds one active identity per organization plus at most one individual identity. */
export const MAX_ACTING_IDENTITIES = 100;
export const SESSION_ACTING_IDENTITY_ORDER_SQL =
  "identity.organization_id IS NOT NULL, organization.name COLLATE NOCASE, identity.id";

interface ActingIdentityRow {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
}

/** Every identity the person holds right now: the individual capacity first, then organizations by name. */
export async function findActingIdentitiesForUser(db: DatabaseLike, userId: string): Promise<SessionActingIdentity[]> {
  const rows = await all<ActingIdentityRow>(
    db,
    `SELECT identity.id, identity.organization_id, organization.name AS organization_name, identity.job_title
       FROM identities identity
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.user_id = ?
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
      ORDER BY ${SESSION_ACTING_IDENTITY_ORDER_SQL}
      LIMIT ?`,
    [userId, MAX_ACTING_IDENTITIES],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    jobTitle: row.job_title,
  }));
}
