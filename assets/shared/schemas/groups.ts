/** Canonical contracts for every configured group type. */
import { z } from "zod";
import { booleanQueryFlagSchema, slugPattern, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { membershipCategorySchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema } from "./urls";

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

/** A leadership display title: "Chair", "Co-Chair", "Lead", "Vice Chair". */
export const groupLeadershipTitleSchema = trimmedString(1, 80);

/**
 * The titles a group type gives its two leadership roles. The roles carry the
 * authority; the titles are what the consortium calls the people holding
 * them, and every assignment snapshots the title it was made with.
 */
export const groupLeadershipTitlesSchema = z.object({
  lead: groupLeadershipTitleSchema,
  deputyLead: groupLeadershipTitleSchema,
});
export type GroupLeadershipTitles = z.infer<typeof groupLeadershipTitlesSchema>;

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
  leadershipTitles: groupLeadershipTitlesSchema,
  active: z.boolean(),
  sortOrder: z.number().int(),
});
export type GroupType = z.infer<typeof groupTypeSchema>;
export const groupTypesListQuerySchema = listQuerySchema(["sort_order", "singular_label", "key"] as const).extend({
  active: booleanQueryFlagSchema.optional(),
});
export type GroupTypesListQuery = z.infer<typeof groupTypesListQuerySchema>;
export const groupTypesListResponseSchema = paginatedResponseSchema("groupTypes", groupTypeSchema);
export const groupCreationCapabilitiesResponseSchema = z.object({ canCreate: z.boolean() });
export type GroupCreationCapabilitiesResponse = z.infer<typeof groupCreationCapabilitiesResponseSchema>;

export const groupLabelSchema = z.object({
  id: groupIdSchema,
  slug: groupSlugSchema,
  name: trimmedString(1, 200),
  type: groupTypeSchema.pick({ key: true, singularLabel: true, pluralLabel: true }),
});
export type GroupLabel = z.infer<typeof groupLabelSchema>;

/** Canonical compact group identity for cross-resource catalogues. */
export const groupSummarySchema = groupLabelSchema.pick({ id: true, slug: true, name: true });
export type GroupSummary = z.infer<typeof groupSummarySchema>;

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
  publicRoster: z.boolean(),
  minEndorsersForBallot: z.number().int().min(0),
  active: z.boolean(),
  revision: groupRevisionSchema,
  membershipCapacityCount: z.number().int().min(0),
  /** Distinct Members (organizations and individual members) with an active capacity. */
  representedMemberCount: z.number().int().min(0).default(0),
  participantCount: z.number().int().min(0),
  childCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Group = z.infer<typeof groupSchema>;

/** Data-minimized group detail safe for an unauthenticated public response. */
export const publicGroupSchema = z.object({
  ...groupLabelSchema.shape,
  parentGroup: groupLabelSchema.nullable(),
  description: z.string().nullable(),
  links: linksSchema,
  visibility: groupVisibilitySchema,
  publicLeadership: z.boolean(),
  publicRoster: z.boolean(),
});
export type PublicGroup = z.infer<typeof publicGroupSchema>;

/** Group presentation data available to an authenticated viewer with live view access. */
export const authenticatedGroupSchema = publicGroupSchema.extend({
  active: z.boolean(),
  membershipCapacityCount: z.number().int().min(0),
  /** Distinct Members (organizations and individual members) with an active capacity. */
  representedMemberCount: z.number().int().min(0).default(0),
  participantCount: z.number().int().min(0),
  childCount: z.number().int().min(0),
});
export type AuthenticatedGroup = z.infer<typeof authenticatedGroupSchema>;

/** Policy and optimistic-concurrency fields exposed only to effective group managers. */
export const groupManagementConfigurationSchema = groupSchema.pick({
  governanceInheritanceMode: true,
  eligibilityMode: true,
  automaticEnrollmentMode: true,
  allowAutomaticOptOut: true,
  minEndorsersForBallot: true,
  revision: true,
});
export type GroupManagementConfiguration = z.infer<typeof groupManagementConfigurationSchema>;
export const groupSettingsDetailSchema = authenticatedGroupSchema.extend(groupManagementConfigurationSchema.shape);
export type GroupSettingsDetail = z.infer<typeof groupSettingsDetailSchema>;

export const GROUP_CAPABILITIES = ["view", "participate", "manage"] as const;
export const groupCapabilitySchema = z.enum(GROUP_CAPABILITIES);
export type GroupCapability = z.infer<typeof groupCapabilitySchema>;
export const authenticatedGroupDetailResponseSchema = z.object({
  group: authenticatedGroupSchema,
  capabilities: z.array(groupCapabilitySchema),
  configuration: groupManagementConfigurationSchema.optional(),
});
export type AuthenticatedGroupDetailResponse = z.infer<typeof authenticatedGroupDetailResponseSchema>;
export const publicGroupDetailResponseSchema = z.object({ group: publicGroupSchema });
export const groupDetailResponseSchema = z.union([
  authenticatedGroupDetailResponseSchema,
  publicGroupDetailResponseSchema,
]);
export type GroupDetailResponse = z.infer<typeof groupDetailResponseSchema>;

const groupPolicyInputShape = {
  governanceInheritanceMode: groupGovernanceInheritanceModeSchema.optional(),
  eligibilityMode: groupEligibilityModeSchema.optional(),
  automaticEnrollmentMode: groupAutomaticEnrollmentModeSchema.optional(),
  allowAutomaticOptOut: z.boolean().optional(),
  publicLeadership: z.boolean().optional(),
  publicRoster: z.boolean().optional(),
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
export type GroupCategoryRule = z.infer<typeof groupCategoryRuleSchema>;
export const groupCategoryRulesReplaceSchema = z.object({
  expectedRevision: groupRevisionSchema.optional(),
  rules: z.array(groupCategoryRuleSchema.omit({ groupId: true })).max(100),
});
export type GroupCategoryRulesReplaceInput = z.infer<typeof groupCategoryRulesReplaceSchema>;
export const groupCategoryRulesResponseSchema = z.object({
  groupId: groupIdSchema,
  revision: groupRevisionSchema,
  rules: z.array(groupCategoryRuleSchema.omit({ groupId: true })),
});
export type GroupCategoryRulesResponse = z.infer<typeof groupCategoryRulesResponseSchema>;

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
  identityId: databaseIdSchema,
  memberId: databaseIdSchema,
  memberType: z.enum(["individual", "organization"]),
  userName: z.string(),
  email: z.email(),
  organizationName: z.string().nullable(),
  membershipCategory: membershipCategorySchema.nullable(),
  source: groupMembershipSourceSchema,
  createdByUserId: databaseIdSchema.nullable(),
  /** Optional roster title for this seat ("Treasurer", "PKI Consortium Chair"); null renders as a plain member. */
  title: z.string().nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});
export type GroupMembership = z.infer<typeof groupMembershipSchema>;

/** A membership's optional roster title, trimmed; null clears it. */
export const groupMembershipTitleSchema = trimmedString(1, 80).nullable();

/**
 * Privacy-reduced roster row for a caller with only the `participate`
 * capability: identity and affiliation, never email or a capacity/membership
 * identifier. Mirrors how `eventAudienceDetailSchema` reduces
 * `eventManagementSummarySchema` for the same manage-vs-participate split.
 */
export const groupParticipantSchema = z.object({
  userId: databaseIdSchema,
  name: z.string(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  organizationName: z.string().nullable(),
});
export type GroupParticipant = z.infer<typeof groupParticipantSchema>;

export const groupCapacitySelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all_eligible"), confirmed: z.literal(true) }),
  z.object({ mode: z.literal("selected"), memberIds: z.array(databaseIdSchema).min(1).max(50) }),
]);
export type GroupCapacitySelection = z.infer<typeof groupCapacitySelectionSchema>;

export const groupJoinSchema = z.object({ capacitySelection: groupCapacitySelectionSchema });

/**
 * A manager adds a person with an optional roster title and service interval.
 * `joinedAt` backdates the seat; a `leftAt` at or before now records a former
 * member in one step, which is how a governing body keeps its history in the
 * same roster as its current seats.
 */
const groupMemberAddShape = {
  capacitySelection: groupCapacitySelectionSchema,
  title: groupMembershipTitleSchema.optional(),
  joinedAt: utcInstantSchema.optional(),
  leftAt: utcInstantSchema.nullable().optional(),
};

function requireOrderedServiceInterval(
  value: { joinedAt?: string; leftAt?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.leftAt && value.joinedAt && value.leftAt < value.joinedAt) {
    ctx.addIssue({ code: "custom", message: "leftAt cannot be before joinedAt", path: ["leftAt"] });
  }
}

/** The request body of the staff add route; the user is addressed by the path. */
export const groupMemberAddBodySchema = z.object(groupMemberAddShape).superRefine(requireOrderedServiceInterval);
export type GroupMemberAddBody = z.infer<typeof groupMemberAddBodySchema>;
export const groupMemberAddSchema = z
  .object({ ...groupMemberAddShape, userId: databaseIdSchema })
  .superRefine(requireOrderedServiceInterval);
export type GroupMemberAddInput = z.infer<typeof groupMemberAddSchema>;

/** Edits one seat's title or service interval; `leftAt: null` reopens an ended seat. */
export const groupMembershipUpdateSchema = z
  .object({
    title: groupMembershipTitleSchema.optional(),
    joinedAt: utcInstantSchema.optional(),
    leftAt: utcInstantSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });
export type GroupMembershipUpdateInput = z.infer<typeof groupMembershipUpdateSchema>;
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
export type GroupLeadershipRoleId = z.infer<typeof groupLeadershipRoleIdSchema>;

/**
 * Titles a manager can pick for each role beside the group type's own
 * default. Any other title is still accepted: the vocabulary is a shortcut,
 * not a constraint, so a type can be renamed without a code change.
 */
export const GROUP_LEADERSHIP_TITLE_SUGGESTIONS: Record<GroupLeadershipRoleId, readonly string[]> = {
  "role-group_lead": ["Chair", "Co-Chair", "Lead", "Co-Lead", "President"],
  "role-group_deputy_lead": ["Vice Chair", "Deputy Lead", "Deputy Chair", "Vice President", "Secretary"],
};

/** The type's default title for one leadership role. */
export function defaultGroupLeadershipTitle(titles: GroupLeadershipTitles, roleId: GroupLeadershipRoleId): string {
  return roleId === "role-group_lead" ? titles.lead : titles.deputyLead;
}

/**
 * One leadership tenure. `startsAt` and `endsAt` are the displayed term;
 * authority itself is active while `active` is true. An `endsAt` in the past
 * is a closed term, one in the future is a scheduled hand-over.
 */
export const groupLeadershipAssignmentSchema = z.object({
  userRoleId: databaseIdSchema,
  userId: databaseIdSchema,
  identityId: databaseIdSchema,
  memberId: databaseIdSchema,
  memberType: z.enum(["individual", "organization"]),
  organizationName: z.string().nullable(),
  userName: z.string(),
  email: z.email(),
  jobTitle: z.string().nullable(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  roleId: groupLeadershipRoleIdSchema,
  title: groupLeadershipTitleSchema,
  sourceGroup: groupLabelSchema,
  inherited: z.boolean(),
  active: z.boolean(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
});
export type GroupLeadershipAssignment = z.infer<typeof groupLeadershipAssignmentSchema>;

function requireOrderedLeadershipTerm(
  value: { startsAt?: string; endsAt?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (value.endsAt && value.startsAt && value.endsAt < value.startsAt) {
    ctx.addIssue({ code: "custom", message: "endsAt cannot be before startsAt", path: ["endsAt"] });
  }
}

/**
 * Assigns leadership through one active participation capacity. The title
 * defaults to the group type's title for the role; `startsAt` defaults to now
 * and may be backdated; an `endsAt` at or before now records a past term.
 */
export const groupLeadershipAssignSchema = z
  .object({
    userId: databaseIdSchema,
    identityId: databaseIdSchema,
    roleId: groupLeadershipRoleIdSchema,
    title: groupLeadershipTitleSchema.optional(),
    startsAt: utcInstantSchema.optional(),
    endsAt: utcInstantSchema.nullable().optional(),
  })
  .superRefine(requireOrderedLeadershipTerm);
export type GroupLeadershipAssignInput = z.infer<typeof groupLeadershipAssignSchema>;

/** Edits a local assignment's title or term; `endsAt: null` makes it open-ended again. */
export const groupLeadershipUpdateSchema = z
  .object({
    title: groupLeadershipTitleSchema.optional(),
    startsAt: utcInstantSchema.optional(),
    endsAt: utcInstantSchema.nullable().optional(),
  })
  .superRefine(requireOrderedLeadershipTerm)
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });
export type GroupLeadershipUpdateInput = z.infer<typeof groupLeadershipUpdateSchema>;

export const groupLeadershipListResponseSchema = z.object({
  group: groupLabelSchema,
  governanceInheritanceMode: groupGovernanceInheritanceModeSchema,
  /** The group type's default titles, used to label roles and pre-fill new assignments. */
  titles: groupLeadershipTitlesSchema,
  /** Effective leadership right now: local assignments plus those inherited from ancestors. */
  assignments: z.array(groupLeadershipAssignmentSchema),
  /** Closed local terms, most recently ended first. */
  past: z.array(groupLeadershipAssignmentSchema),
});
export type GroupLeadershipListResponse = z.infer<typeof groupLeadershipListResponseSchema>;

export const GROUP_SORT_COLUMNS = ["name", "slug", "type", "participant_count", "created_at"] as const;
export const groupsListQuerySchema = listQuerySchema(GROUP_SORT_COLUMNS).extend({
  /** Restrict the page to one exact group; composes with the participation views. */
  id: groupIdSchema.optional(),
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

export const GROUP_MEMBERSHIP_SORT_COLUMNS = [
  "user_name",
  "email",
  "organization_name",
  "membership_category",
  "joined_at",
  "left_at",
] as const;
/** The subset of {@link GROUP_MEMBERSHIP_SORT_COLUMNS} the reduced participant roster may sort by. */
export const GROUP_PARTICIPANT_SORT_COLUMNS = ["user_name", "organization_name"] as const;
export const groupMembershipsListQuerySchema = listQuerySchema(GROUP_MEMBERSHIP_SORT_COLUMNS).extend({
  userId: databaseIdSchema.optional(),
  memberId: databaseIdSchema.optional(),
  membershipCategory: membershipCategorySchema.optional(),
  active: booleanQueryFlagSchema.default(true),
});
export type GroupMembershipsListQuery = z.infer<typeof groupMembershipsListQuerySchema>;
export const groupMembershipsManagementListResponseSchema = paginatedResponseSchema(
  "memberships",
  groupMembershipSchema,
);
export const groupMembershipsParticipantListResponseSchema = paginatedResponseSchema(
  "memberships",
  groupParticipantSchema,
);
/**
 * Scope-appropriate membership page payload: an effective group manager gets
 * every row as the full `groupMembershipSchema`, and a caller with only the
 * `participate` capability gets every row as the reduced `groupParticipantSchema`.
 * This is the same one-endpoint, capability-shaped union `eventsListResponseSchema`
 * uses for the events list.
 */
export const groupMembershipsListResponseSchema = z.union([
  groupMembershipsManagementListResponseSchema,
  groupMembershipsParticipantListResponseSchema,
]);

export const groupReferenceParamsSchema = z.object({ groupId: groupReferenceSchema });
export const groupMembershipParamsSchema = groupReferenceParamsSchema.extend({ membershipId: databaseIdSchema });
export const groupResponseSchema = z.object({ group: groupSchema });
