/** The identities a user session may act as, read from live identity state. */
import type { SessionActingIdentity } from "../../../assets/shared/session-acting-identity";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import { sqlValue, type SqlId } from "../db/sql-value";
import { batchRows } from "../db/pagination";
import type { D1StatementResult } from "../types";

/** A person holds one active identity per organization plus at most one individual identity. */
export const MAX_ACTING_IDENTITIES = 100;
export const SESSION_ACTING_IDENTITY_ORDER_SQL =
  "identity.organization_id IS NOT NULL, organization.name COLLATE NOCASE, identity.id";

/** The active membership an identity holds, if any; an identity of a lapsed or absent membership reads as none. */
export const SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL = `(SELECT capacity.membership_category
    FROM identity_member_capacities capacity
    JOIN membership_categories category ON category.code = capacity.membership_category
   WHERE capacity.identity_id = identity.id AND capacity.member_status = 'active'
   ORDER BY category.display_order, category.code LIMIT 1)`;

/** The consortium's name for that membership category. */
export const SESSION_ACTING_IDENTITY_MEMBERSHIP_LABEL_SQL = `(SELECT category.label
    FROM identity_member_capacities capacity
    JOIN membership_categories category ON category.code = capacity.membership_category
   WHERE capacity.identity_id = identity.id AND capacity.member_status = 'active'
   ORDER BY category.display_order, category.code LIMIT 1)`;

interface ActingIdentityRow {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
  membership_category: string | null;
  membership_label: string | null;
}

/** Every identity the person holds right now: the individual capacity first, then organizations by name. */
export async function findActingIdentitiesForUser(db: DatabaseLike, userId: string): Promise<SessionActingIdentity[]> {
  const read = actingIdentitiesSelection(userId);
  return toActingIdentities(await all<ActingIdentityRow>(db, read.sql, read.bindings));
}

export function actingIdentitiesSelection(userId: SqlId) {
  const user = sqlValue(userId);
  return {
    sql: `SELECT identity.id, identity.organization_id, organization.name AS organization_name, identity.job_title,
            ${SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL} AS membership_category,
            ${SESSION_ACTING_IDENTITY_MEMBERSHIP_LABEL_SQL} AS membership_label
       FROM identities identity
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.user_id = ${user.sql}
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
      ORDER BY ${SESSION_ACTING_IDENTITY_ORDER_SQL}
      LIMIT ?`,
    bindings: [...user.bindings, MAX_ACTING_IDENTITIES],
  };
}
export function decodeActingIdentities(result: D1StatementResult): SessionActingIdentity[] {
  return toActingIdentities(batchRows<ActingIdentityRow>(result));
}
function toActingIdentities(rows: ActingIdentityRow[]): SessionActingIdentity[] {
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    jobTitle: row.job_title,
    membershipCategory: row.membership_category,
    membershipLabel: row.membership_label,
  }));
}
