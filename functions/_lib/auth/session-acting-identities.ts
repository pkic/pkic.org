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

/**
 * `identity_member_capacities` for the one identity in scope, active rows only.
 * Correlating the view itself scans it whole for every identity read, which
 * this runs on each signed-in request and for every person in a live room.
 */
const ACTING_IDENTITY_ACTIVE_CAPACITY_SQL = `
    SELECT assignment.category_code AS membership_category
      FROM members member
      JOIN member_category_assignments assignment ON assignment.member_id = member.id
     WHERE member.status = 'active' AND member.organization_id = identity.organization_id
    UNION ALL
    SELECT assignment.category_code
      FROM members member
      JOIN member_category_assignments assignment ON assignment.member_id = member.id
     WHERE member.status = 'active' AND identity.organization_id IS NULL AND member.identity_id = identity.id`;

/** The active membership an identity holds, if any; an identity of a lapsed or absent membership reads as none. */
export const SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL = `(SELECT capacity.membership_category
    FROM (${ACTING_IDENTITY_ACTIVE_CAPACITY_SQL}) capacity
    JOIN membership_categories category ON category.code = capacity.membership_category
   ORDER BY category.display_order, category.code LIMIT 1)`;

/** Joins that membership's category once per identity, for both its code and its label. */
export const SESSION_ACTING_IDENTITY_MEMBERSHIP_JOIN_SQL = `LEFT JOIN membership_categories held_category ON held_category.code = ${SESSION_ACTING_IDENTITY_MEMBERSHIP_SQL}`;
export const SESSION_ACTING_IDENTITY_MEMBERSHIP_COLUMNS_SQL =
  "held_category.code AS membership_category, held_category.label AS membership_label";

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
            ${SESSION_ACTING_IDENTITY_MEMBERSHIP_COLUMNS_SQL}
       FROM identities identity
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
       ${SESSION_ACTING_IDENTITY_MEMBERSHIP_JOIN_SQL}
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
