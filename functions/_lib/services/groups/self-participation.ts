import type { SelfGroup, SelfGroupsListQuery } from "../../../../assets/shared/schemas/group-participation";
import { membershipCategorySchema } from "../../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike } from "../../types";
import { listEligibleGroupCapacitiesForGroups } from "./capacities";
import { listActiveGroupMembershipsForGroupsForUser, listGroups } from "./read-model";

/**
 * One generic, set-based read model for self-service participation in every
 * group type. The bounded group page is enriched with two D1 queries, never a
 * query per group.
 */
export async function listSelfGroups(
  db: DatabaseLike,
  userId: string,
  query: SelfGroupsListQuery,
): Promise<{ groups: SelfGroup[]; total: number }> {
  const { view, ...groupQuery } = query;
  const page = await listGroups(db, groupQuery, {
    userId,
    canReadAll: false,
    participationView: view,
  });
  const groupIds = page.groups.map((group) => group.id);
  const [memberships, eligibleCapacities] = await Promise.all([
    listActiveGroupMembershipsForGroupsForUser(db, groupIds, userId),
    listEligibleGroupCapacitiesForGroups(db, groupIds, userId, {
      allowManaged: false,
      requireParentMembership: true,
    }),
  ]);
  return {
    total: page.total,
    groups: page.groups.map((group) => ({
      ...group,
      memberships: (memberships.get(group.id) ?? []).map((membership) => ({
        id: membership.id,
        memberId: membership.memberId,
        memberType: membership.memberType,
        organizationName: membership.organizationName,
        membershipCategory: membershipCategorySchema.parse(membership.membershipCategory),
        source: membership.source,
        joinedAt: membership.joinedAt,
      })),
      eligibleCapacities: eligibleCapacities.get(group.id) ?? [],
    })),
  };
}
