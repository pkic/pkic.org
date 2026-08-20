import { all } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export interface LeadershipAffiliation {
  memberId: string;
  organizationName: string | null;
  membershipCategory: string;
}

interface LeadershipAffiliationRow {
  member_id: string;
  organization_name: string | null;
  category_code: string;
}

/**
 * Every active membership a user may explicitly represent in a leadership
 * position. Individual and organization memberships intentionally share the
 * same members.id identity, so leadership_positions needs only one FK.
 */
export async function listLeadershipAffiliations(db: DatabaseLike, userId: string): Promise<LeadershipAffiliation[]> {
  const rows = await all<LeadershipAffiliationRow>(
    db,
    `SELECT m.id AS member_id, NULL AS organization_name, mca.category_code, 0 AS sort_rank
     FROM members m
     JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE m.user_id = ? AND m.status = 'active'

     UNION ALL

     SELECT m.id AS member_id, o.name AS organization_name, mca.category_code, 1 AS sort_rank
     FROM organization_representatives r
     JOIN members m ON m.id = r.member_id
     JOIN organizations o ON o.id = m.organization_id
     JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE r.user_id = ? AND r.left_at IS NULL AND m.status = 'active'

     ORDER BY sort_rank ASC, organization_name ASC, member_id ASC`,
    [userId, userId],
  );

  return rows.map((row) => ({
    memberId: row.member_id,
    organizationName: row.organization_name,
    membershipCategory: row.category_code,
  }));
}

/**
 * Resolve an explicit affiliation. Older/simpler clients may omit memberId
 * when there is zero or one possible choice, but must choose when there are
 * multiple memberships; a nullable value is an explicit "none" choice.
 */
export async function resolveLeadershipAffiliation(
  db: DatabaseLike,
  userId: string,
  memberId: string | null | undefined,
): Promise<string | null> {
  if (memberId === null) return null;

  const affiliations = await listLeadershipAffiliations(db, userId);
  if (memberId !== undefined) {
    if (!affiliations.some((affiliation) => affiliation.memberId === memberId)) {
      throw new AppError(422, "INVALID_AFFILIATION", "The selected membership is not active for this user");
    }
    return memberId;
  }

  if (affiliations.length > 1) {
    throw new AppError(
      422,
      "AFFILIATION_REQUIRED",
      "Select which membership this leadership position represents, or explicitly select no affiliation",
    );
  }
  return affiliations[0]?.memberId ?? null;
}
