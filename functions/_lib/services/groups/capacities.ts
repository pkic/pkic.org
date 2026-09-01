import type { GroupCapacitySelection } from "../../../../assets/shared/schemas/groups";
import type { MembershipCategory } from "../../../../assets/shared/schemas/membership-categories";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { all, first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import {
  ACTIVE_USER_CAPACITIES_CTE,
  activeParentGroupMembershipPredicate,
  eligibleGroupCapacityPredicate,
} from "../membership/capacity-query";

export interface EligibleGroupCapacity {
  identityId: string;
  memberId: string;
  memberType: "individual" | "organization";
  organizationName: string | null;
  membershipCategory: MembershipCategory;
}

interface CapacityRow {
  identity_id: string;
  member_id: string;
  member_type: "individual" | "organization";
  organization_name: string | null;
  membership_category: MembershipCategory;
}

export function groupJoinEligibilityEvidence(
  groupId: string,
  userId: string,
  memberIds: readonly string[],
  options: { allowManaged: boolean },
): AuthorizationEvidence {
  const requestedMemberIds = [...new Set(memberIds)];
  if (requestedMemberIds.length === 0) return { sql: "SELECT 1 WHERE 0", bindings: [] };
  return {
    sql: `${ACTIVE_USER_CAPACITIES_CTE}
          SELECT 1
            FROM groups g
           WHERE g.id = ? AND g.active = 1
             AND ${activeParentGroupMembershipPredicate("g", "?")}
             AND (
               SELECT COUNT(*)
                 FROM active_user_capacities capacity
                 JOIN json_each(?) requested ON requested.value = capacity.member_id
                 LEFT JOIN group_membership_category_rules rule
                   ON rule.group_id = g.id
                  AND rule.membership_category_code = capacity.membership_category
                WHERE ${eligibleGroupCapacityPredicate("g", "rule", "?")}
             ) = ?`,
    bindings: [
      userId,
      groupId,
      userId,
      JSON.stringify(requestedMemberIds),
      options.allowManaged ? 1 : 0,
      requestedMemberIds.length,
    ],
  };
}

export function prepareGroupJoinEligibilityGuard(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  memberIds: readonly string[],
  options: { allowManaged: boolean },
): StatementLike {
  return prepareAuthorizationGuard(db, groupJoinEligibilityEvidence(groupId, userId, memberIds, options));
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
     SELECT capacity.identity_id, capacity.member_id, capacity.member_type, capacity.organization_name,
            capacity.membership_category
     FROM active_user_capacities capacity
     JOIN groups g ON g.id = ? AND g.active = 1
     LEFT JOIN group_membership_category_rules rule
       ON rule.group_id = g.id
      AND rule.membership_category_code = capacity.membership_category
     WHERE ${eligibleGroupCapacityPredicate("g", "rule", "?")}
       AND ${activeParentGroupMembershipPredicate("g", "?")}
     ORDER BY capacity.organization_name COLLATE NOCASE, capacity.member_id`,
    [userId, groupId, options.allowManaged ? 1 : 0, userId],
  );
  return rows.map((row) => ({
    identityId: row.identity_id,
    memberId: row.member_id,
    memberType: row.member_type,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  }));
}

export async function listEligibleGroupCapacitiesForGroups(
  db: DatabaseLike,
  groupIds: readonly string[],
  userId: string,
  options: { allowManaged: boolean; requireParentMembership: boolean },
): Promise<Map<string, EligibleGroupCapacity[]>> {
  const byGroup = new Map<string, EligibleGroupCapacity[]>();
  if (groupIds.length === 0) return byGroup;
  const parentPredicate = options.requireParentMembership ? activeParentGroupMembershipPredicate("g", "?") : "1 = 1";
  const rows = await all<CapacityRow & { group_id: string }>(
    db,
    `${ACTIVE_USER_CAPACITIES_CTE}
     SELECT g.id AS group_id, capacity.identity_id, capacity.member_id, capacity.member_type,
            capacity.organization_name, capacity.membership_category
       FROM json_each(?) requested_group
       JOIN groups g ON g.id = requested_group.value AND g.active = 1
       CROSS JOIN active_user_capacities capacity
       LEFT JOIN group_membership_category_rules rule
         ON rule.group_id = g.id
        AND rule.membership_category_code = capacity.membership_category
      WHERE ${eligibleGroupCapacityPredicate("g", "rule", "?")}
        AND ${parentPredicate}
      ORDER BY g.id, capacity.organization_name COLLATE NOCASE, capacity.member_id`,
    [
      userId,
      JSON.stringify(groupIds),
      options.allowManaged ? 1 : 0,
      ...(options.requireParentMembership ? [userId] : []),
    ],
  );
  for (const row of rows) {
    const capacities = byGroup.get(row.group_id) ?? [];
    capacities.push({
      identityId: row.identity_id,
      memberId: row.member_id,
      memberType: row.member_type,
      organizationName: row.organization_name,
      membershipCategory: row.membership_category,
    });
    byGroup.set(row.group_id, capacities);
  }
  return byGroup;
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
    const group = await first<{ active: number; parent_eligible: number }>(
      db,
      `SELECT g.active,
              CASE WHEN ${activeParentGroupMembershipPredicate("g", "?")} THEN 1 ELSE 0 END AS parent_eligible
         FROM groups g WHERE g.id = ?`,
      [userId, groupId],
    );
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
    if (group.active !== 1) throw new AppError(409, "GROUP_INACTIVE", "This group is not accepting participants");
    if (group.parent_eligible !== 1) {
      throw new AppError(
        403,
        "GROUP_PARENT_MEMBERSHIP_REQUIRED",
        "Active parent group membership is required before joining this group",
      );
    }
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
