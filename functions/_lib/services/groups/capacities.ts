import type { GroupCapacitySelection } from "../../../../assets/shared/schemas/groups";
import { AppError } from "../../errors";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { ACTIVE_USER_CAPACITIES_CTE } from "../membership/capacity-query";

export interface EligibleGroupCapacity {
  memberId: string;
  memberType: "individual" | "organization";
  organizationName: string | null;
  membershipCategory: string;
}

interface CapacityRow {
  member_id: string;
  member_type: "individual" | "organization";
  organization_name: string | null;
  membership_category: string;
}

/**
 * Resolves every currently valid capacity in one D1 query. Individual
 * participation is omitted whenever the user actively represents any
 * organization, keeping IPR attribution unambiguous at the source.
 */
export async function listEligibleGroupCapacities(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  options: { allowManaged: boolean },
): Promise<EligibleGroupCapacity[]> {
  const rows = await all<CapacityRow>(
    db,
    `${ACTIVE_USER_CAPACITIES_CTE}
     SELECT capacity.member_id, capacity.member_type, capacity.organization_name,
            capacity.membership_category
     FROM active_user_capacities capacity
     JOIN groups g ON g.id = ? AND g.active = 1
     LEFT JOIN group_membership_category_rules rule
       ON rule.group_id = g.id
      AND rule.membership_category_code = capacity.membership_category
     WHERE g.eligibility_mode = 'open'
        OR (g.eligibility_mode = 'category' AND rule.permits_join = 1)
        OR (g.eligibility_mode = 'managed' AND ? = 1)
     ORDER BY capacity.organization_name COLLATE NOCASE, capacity.member_id`,
    [userId, groupId, options.allowManaged ? 1 : 0],
  );
  return rows.map((row) => ({
    memberId: row.member_id,
    memberType: row.member_type,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  }));
}

export async function selectGroupCapacities(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  selection: GroupCapacitySelection,
  options: { allowManaged: boolean },
): Promise<EligibleGroupCapacity[]> {
  const eligible = await listEligibleGroupCapacities(db, groupId, userId, options);
  if (eligible.length === 0) {
    const group = await first<{ active: number }>(db, "SELECT active FROM groups WHERE id = ?", [groupId]);
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
    if (group.active !== 1) throw new AppError(409, "GROUP_INACTIVE", "This group is not accepting participants");
    throw new AppError(403, "GROUP_CAPACITY_REQUIRED", "No eligible Member capacity is available for this group");
  }
  if (selection.mode === "all_eligible") return eligible;

  const requested = new Set(selection.memberIds);
  const selected = eligible.filter((capacity) => requested.has(capacity.memberId));
  if (selected.length !== requested.size) {
    throw new AppError(403, "GROUP_CAPACITY_INELIGIBLE", "One or more selected Member capacities are not eligible");
  }
  return selected;
}
