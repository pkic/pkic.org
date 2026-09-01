import { all } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface LeadershipAffiliation {
  identityId: string;
  memberId: string;
  organizationName: string | null;
  membershipCategory: string;
}

interface LeadershipAffiliationRow {
  identity_id: string;
  member_id: string;
  organization_name: string | null;
  category_code: string;
}

/**
 * Every active identity a user may explicitly act through in a leadership
 * position. The position stores this exact identity so a later role change
 * cannot rewrite the historical affiliation.
 */
export async function listLeadershipAffiliations(db: DatabaseLike, userId: string): Promise<LeadershipAffiliation[]> {
  const rows = await all<LeadershipAffiliationRow>(
    db,
    `SELECT identity.id AS identity_id, capacity.member_id,
            organization.name AS organization_name,
            capacity.membership_category AS category_code,
            CASE WHEN identity.organization_id IS NULL THEN 0 ELSE 1 END AS sort_rank
       FROM identities identity
       JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
  LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE identity.user_id = ?
        AND identity.started_at IS NOT NULL
        AND identity.ended_at IS NULL
        AND identity.blocked_at IS NULL
        AND capacity.member_status = 'active'

      ORDER BY sort_rank ASC, organization_name ASC, identity_id ASC`,
    [userId],
  );

  return rows.map((row) => ({
    identityId: row.identity_id,
    memberId: row.member_id,
    organizationName: row.organization_name,
    membershipCategory: row.category_code,
  }));
}

/**
 * Resolve an explicit affiliation. Simpler clients may omit identityId
 * when there is zero or one possible choice, but must choose when there are
 * multiple memberships; a nullable value is an explicit "none" choice.
 */
export async function resolveLeadershipAffiliation(
  db: DatabaseLike,
  userId: string,
  identityId: string | null | undefined,
): Promise<string | null> {
  if (identityId === null) return null;

  const affiliations = await listLeadershipAffiliations(db, userId);
  if (identityId !== undefined) {
    if (!affiliations.some((affiliation) => affiliation.identityId === identityId)) {
      throw new AppError(422, "INVALID_AFFILIATION", "The selected identity is not active for this user");
    }
    return identityId;
  }

  if (affiliations.length > 1) {
    throw new AppError(
      422,
      "AFFILIATION_REQUIRED",
      "Select which membership this leadership position represents, or explicitly select no affiliation",
    );
  }
  return affiliations[0]?.identityId ?? null;
}
