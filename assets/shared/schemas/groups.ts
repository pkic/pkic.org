/** Canonical contracts for every configured group type. */
import { z } from "zod";
import { booleanQueryFlagSchema, slugPattern, trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { membershipCategorySchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const groupIdSchema = databaseIdSchema;
export const groupRevisionSchema = z.number().int().min(0);
export const groupSlugSchema = z.string().trim().min(1).max(200).regex(slugPattern);
export const groupReferenceSchema = z.union([groupIdSchema, groupSlugSchema]);
export const groupTypeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);

export const GROUP_GOVERNANCE_INHERITANCE_MODES = ["inherited", "local_only"] as const;
export const groupGovernanceInheritanceModeSchema = z.enum(GROUP_GOVERNANCE_INHERITANCE_MODES);
export const GROUP_ELIGIBILITY_MODES = ["open", "category", "managed"] as const;
export const groupEligibilityModeSchema = z.enum(GROUP_ELIGIBILITY_MODES);
export const GROUP_AUTOMATIC_ENROLLMENT_MODES = ["none", "category"] as const;
export const groupAutomaticEnrollmentModeSchema = z.enum(GROUP_AUTOMATIC_ENROLLMENT_MODES);
export const GROUP_VISIBILITIES = ["public", "authenticated", "participants", "managed"] as const;
export const groupVisibilitySchema = z.enum(GROUP_VISIBILITIES);

export const groupTypeSchema = z.object({
  key: groupTypeKeySchema,
  singularLabel: trimmedString(1, 80),
  pluralLabel: trimmedString(1, 100),
  description: z.string().nullable(),
  defaultGovernanceInheritanceMode: groupGovernanceInheritanceModeSchema,
  defaultEligibilityMode: groupEligibilityModeSchema,
  defaultAutomaticEnrollmentMode: groupAutomaticEnrollmentModeSchema,
  defaultAllowAutomaticOptOut: z.boolean(),
  defaultVisibility: groupVisibilitySchema,
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type GroupType = z.infer<typeof groupTypeSchema>;
export const groupTypesListQuerySchema = listQuerySchema(["sort_order", "singular_label", "key"] as const).extend({
  active: booleanQueryFlagSchema.optional(),
});
export type GroupTypesListQuery = z.infer<typeof groupTypesListQuerySchema>;
export const groupTypesListResponseSchema = paginatedResponseSchema("groupTypes", groupTypeSchema);

export const groupLabelSchema = z.object({
  id: groupIdSchema,
  slug: groupSlugSchema,
  name: trimmedString(1, 200),
  type: groupTypeSchema.pick({ key: true, singularLabel: true, pluralLabel: true }),
});
export type GroupLabel = z.infer<typeof groupLabelSchema>;

export const groupSchema = z.object({
  ...groupLabelSchema.shape,
  parentGroup: groupLabelSchema.nullable(),
  description: z.string().nullable(),
  links: linksSchema,
  visibility: groupVisibilitySchema,
  governanceInheritanceMode: groupGovernanceInheritanceModeSchema,
  eligibilityMode: groupEligibilityModeSchema,
  automaticEnrollmentMode: groupAutomaticEnrollmentModeSchema,
  allowAutomaticOptOut: z.boolean(),
  publicLeadership: z.boolean(),
  minEndorsersForBallot: z.number().int().min(0),
  active: z.boolean(),
  revision: groupRevisionSchema,
  membershipCapacityCount: z.number().int().min(0),
  participantCount: z.number().int().min(0),
  childCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Group = z.infer<typeof groupSchema>;

export const GROUP_PORTAL_CAPABILITIES = ["view", "participate", "manage"] as const;
export const groupPortalCapabilitySchema = z.enum(GROUP_PORTAL_CAPABILITIES);
export type GroupPortalCapability = z.infer<typeof groupPortalCapabilitySchema>;
export const groupPortalContextResponseSchema = z.object({
  group: groupSchema,
  capabilities: z.array(groupPortalCapabilitySchema),
});
export type GroupPortalContextResponse = z.infer<typeof groupPortalContextResponseSchema>;

const groupPolicyInputShape = {
  governanceInheritanceMode: groupGovernanceInheritanceModeSchema.optional(),
  eligibilityMode: groupEligibilityModeSchema.optional(),
  automaticEnrollmentMode: groupAutomaticEnrollmentModeSchema.optional(),
  allowAutomaticOptOut: z.boolean().optional(),
  publicLeadership: z.boolean().optional(),
  minEndorsersForBallot: z.number().int().min(0).max(1000).optional(),
};

export const groupCreateSchema = z.object({
  typeKey: groupTypeKeySchema,
  parentGroupId: groupIdSchema.nullable().optional(),
  name: trimmedString(1, 200),
  slug: groupSlugSchema.optional(),
  description: trimmedString(0, 4000).nullable().optional(),
  links: linksSchema.optional(),
  visibility: groupVisibilitySchema.optional(),
  ...groupPolicyInputShape,
});
export type GroupCreateInput = z.infer<typeof groupCreateSchema>;

export const groupUpdateSchema = z.object({
  expectedRevision: groupRevisionSchema.optional(),
  typeKey: groupTypeKeySchema.optional(),
  parentGroupId: groupIdSchema.nullable().optional(),
  name: trimmedString(1, 200).optional(),
  slug: groupSlugSchema.optional(),
  description: trimmedString(0, 4000).nullable().optional(),
  links: linksSchema.optional(),
  visibility: groupVisibilitySchema.optional(),
  active: z.boolean().optional(),
  ...groupPolicyInputShape,
});
export type GroupUpdateInput = z.infer<typeof groupUpdateSchema>;

export const groupCategoryRuleSchema = z.object({
  groupId: groupIdSchema,
  membershipCategory: membershipCategorySchema,
  permitsJoin: z.boolean(),
  automaticEnrollment: z.boolean(),
});
export const groupCategoryRulesReplaceSchema = z.object({
  expectedRevision: groupRevisionSchema.optional(),
  rules: z.array(groupCategoryRuleSchema.omit({ groupId: true })).max(100),
});
export type GroupCategoryRulesReplaceInput = z.infer<typeof groupCategoryRulesReplaceSchema>;

export const GROUP_MEMBERSHIP_SOURCES = [
  "self_service",
  "organization_contact",
  "staff",
  "automatic_policy",
  "migration",
] as const;
export const groupMembershipSourceSchema = z.enum(GROUP_MEMBERSHIP_SOURCES);
export type GroupMembershipSource = z.infer<typeof groupMembershipSourceSchema>;

export const groupMembershipSchema = z.object({
  id: databaseIdSchema,
  groupId: groupIdSchema,
  userId: databaseIdSchema,
  memberId: databaseIdSchema,
  memberType: z.enum(["individual", "organization"]),
  userName: z.string(),
  email: z.email(),
  organizationName: z.string().nullable(),
  membershipCategory: membershipCategorySchema.nullable(),
  source: groupMembershipSourceSchema,
  createdByUserId: databaseIdSchema.nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});
export type GroupMembership = z.infer<typeof groupMembershipSchema>;

export const groupCapacitySelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_eligible"), confirmed: z.literal(true) }),
  z.object({ mode: z.literal("selected"), memberIds: z.array(databaseIdSchema).min(1).max(50) }),
]);
export type GroupCapacitySelection = z.infer<typeof groupCapacitySelectionSchema>;

export const groupJoinSchema = z.object({ capacitySelection: groupCapacitySelectionSchema });
export const groupMemberAddSchema = groupJoinSchema.extend({ userId: databaseIdSchema });
export const groupLeaveSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("selected"), memberIds: z.array(databaseIdSchema).min(1).max(50) }),
]);
export type GroupLeaveInput = z.infer<typeof groupLeaveSchema>;

export const groupMembershipMutationResponseSchema = z.object({
  group: groupLabelSchema,
  memberships: z.array(groupMembershipSchema),
  endedMembershipIds: z.array(databaseIdSchema),
});
export type GroupMembershipMutationResponse = z.infer<typeof groupMembershipMutationResponseSchema>;
export const groupAutomaticEnrollmentPreferenceSchema = z.object({ optedOut: z.boolean() });
export const groupAutomaticEnrollmentPreferenceResponseSchema = z.object({
  success: z.literal(true),
  optedOut: z.boolean(),
});

export const GROUP_LEADERSHIP_ROLE_IDS = ["role-group_lead", "role-group_deputy_lead"] as const;
export const groupLeadershipRoleIdSchema = z.enum(GROUP_LEADERSHIP_ROLE_IDS);
export const groupLeadershipAssignmentSchema = z.object({
  userRoleId: databaseIdSchema,
  userId: databaseIdSchema,
  userName: z.string(),
  email: z.email(),
  roleId: groupLeadershipRoleIdSchema,
  sourceGroup: groupLabelSchema,
  inherited: z.boolean(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type GroupLeadershipAssignment = z.infer<typeof groupLeadershipAssignmentSchema>;
export const groupLeadershipAssignSchema = z.object({
  userId: databaseIdSchema,
  roleId: groupLeadershipRoleIdSchema,
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type GroupLeadershipAssignInput = z.infer<typeof groupLeadershipAssignSchema>;
export const groupLeadershipListResponseSchema = z.object({
  group: groupLabelSchema,
  governanceInheritanceMode: groupGovernanceInheritanceModeSchema,
  assignments: z.array(groupLeadershipAssignmentSchema),
});
export type GroupLeadershipListResponse = z.infer<typeof groupLeadershipListResponseSchema>;

export const GROUP_SORT_COLUMNS = ["name", "slug", "type", "participant_count", "created_at"] as const;
export const groupsListQuerySchema = listQuerySchema(GROUP_SORT_COLUMNS).extend({
  /** Restricts the page to groups the authenticated management identity may update. */
  manageable: booleanQueryFlagSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  typeKey: groupTypeKeySchema.optional(),
  parentGroupId: groupIdSchema.nullable().optional(),
  eligibilityMode: groupEligibilityModeSchema.optional(),
  automaticEnrollmentMode: groupAutomaticEnrollmentModeSchema.optional(),
  visibility: groupVisibilitySchema.optional(),
});
export type GroupsListQuery = z.infer<typeof groupsListQuerySchema>;
export const groupsListResponseSchema = paginatedResponseSchema("groups", groupSchema);
export const groupGetQuerySchema = groupsListQuerySchema.pick({ manageable: true });

export const GROUP_MEMBERSHIP_SORT_COLUMNS = [
  "user_name",
  "email",
  "organization_name",
  "membership_category",
  "joined_at",
] as const;
export const groupMembershipsListQuerySchema = listQuerySchema(GROUP_MEMBERSHIP_SORT_COLUMNS).extend({
  userId: databaseIdSchema.optional(),
  memberId: databaseIdSchema.optional(),
  membershipCategory: membershipCategorySchema.optional(),
  active: booleanQueryFlagSchema.default(true),
});
export type GroupMembershipsListQuery = z.infer<typeof groupMembershipsListQuerySchema>;
export const groupMembershipsListResponseSchema = paginatedResponseSchema("memberships", groupMembershipSchema);

export const groupReferenceParamsSchema = z.object({ groupId: groupReferenceSchema });
export const groupMembershipParamsSchema = groupReferenceParamsSchema.extend({ membershipId: databaseIdSchema });
export const groupResponseSchema = z.object({ group: groupSchema });
