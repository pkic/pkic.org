/** Generic self-service participation contracts shared by every group type. */
import { z } from "zod";
import { groupMembershipSchema, groupSchema, groupsListQuerySchema } from "./groups";
import { membershipCategorySchema } from "./membership-categories";
import { paginatedResponseSchema } from "./pagination";

export const groupParticipationCapacitySchema = z.object({
  memberId: groupMembershipSchema.shape.memberId,
  memberType: groupMembershipSchema.shape.memberType,
  organizationName: z.string().nullable(),
  membershipCategory: membershipCategorySchema,
});
export type GroupParticipationCapacity = z.infer<typeof groupParticipationCapacitySchema>;

export const selfGroupMembershipSchema = groupMembershipSchema
  .pick({
    id: true,
    memberId: true,
    memberType: true,
    organizationName: true,
    source: true,
    joinedAt: true,
  })
  .extend({ membershipCategory: membershipCategorySchema });
export type SelfGroupMembership = z.infer<typeof selfGroupMembershipSchema>;

export const selfGroupSchema = groupSchema.extend({
  eligibleCapacities: z.array(groupParticipationCapacitySchema),
  memberships: z.array(selfGroupMembershipSchema),
});
export type SelfGroup = z.infer<typeof selfGroupSchema>;

export const SELF_GROUP_VIEWS = ["catalog", "joined"] as const;
export const selfGroupsListQuerySchema = groupsListQuerySchema
  .pick({ q: true, typeKey: true, sort: true, limit: true, offset: true })
  .extend({ view: z.enum(SELF_GROUP_VIEWS).default("catalog") });
export type SelfGroupsListQuery = z.infer<typeof selfGroupsListQuerySchema>;

export const selfGroupsListResponseSchema = paginatedResponseSchema("groups", selfGroupSchema);
