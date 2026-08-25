/** OpenAPI route contracts for the canonical group boundary. */
import { jsonErrorResponse } from "./api-common";
import {
  groupCategoryRulesReplaceSchema,
  groupAutomaticEnrollmentPreferenceResponseSchema,
  groupAutomaticEnrollmentPreferenceSchema,
  groupCreateSchema,
  groupJoinSchema,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  groupLeaveSchema,
  groupMemberAddSchema,
  groupMembershipMutationResponseSchema,
  groupMembershipParamsSchema,
  groupMembershipsListQuerySchema,
  groupMembershipsListResponseSchema,
  groupReferenceParamsSchema,
  groupResponseSchema,
  groupTypesListQuerySchema,
  groupTypesListResponseSchema,
  groupUpdateSchema,
  groupsListQuerySchema,
  groupsListResponseSchema,
} from "./groups";
import { databaseIdSchema } from "./identifiers";

export const groupTypesListRouteSchema = {
  tags: ["Groups"],
  summary: "List configured group types",
  request: { query: groupTypesListQuerySchema },
  responses: {
    "200": {
      description: "Configured group types.",
      content: { "application/json": { schema: groupTypesListResponseSchema } },
    },
  },
};

export const groupsListRouteSchema = {
  tags: ["Groups"],
  summary: "List groups visible to the caller",
  description: "Search, filtering, sorting, counting, and pagination are executed in D1.",
  request: { query: groupsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded group page.",
      content: { "application/json": { schema: groupsListResponseSchema } },
    },
  },
};

export const groupGetRouteSchema = {
  tags: ["Groups"],
  summary: "Get one group",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": { description: "Group detail.", content: { "application/json": { schema: groupResponseSchema } } },
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Create a group",
  request: { body: { required: true, content: { "application/json": { schema: groupCreateSchema } } } },
  responses: {
    "201": { description: "Group created.", content: { "application/json": { schema: groupResponseSchema } } },
    "403": jsonErrorResponse("The caller may not create this group."),
    "409": jsonErrorResponse("The group slug already exists or the hierarchy is invalid."),
  },
};

export const groupUpdateRouteSchema = {
  tags: ["Groups"],
  summary: "Update a group",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupUpdateSchema } } },
  },
  responses: {
    "200": { description: "Group updated.", content: { "application/json": { schema: groupResponseSchema } } },
    "403": jsonErrorResponse("The caller lacks effective management permission."),
    "409": jsonErrorResponse("The update would create a cycle or unsafe local-only governance."),
  },
};

export const groupMembershipsListRouteSchema = {
  tags: ["Groups"],
  summary: "List group membership capacities",
  description: "One row is one user participating for one Member; a user may appear more than once.",
  request: { params: groupReferenceParamsSchema, query: groupMembershipsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded membership-capacity page.",
      content: { "application/json": { schema: groupMembershipsListResponseSchema } },
    },
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupJoinRouteSchema = {
  tags: ["Groups"],
  summary: "Join a group",
  description: "all_eligible requires explicit confirmation; selected requires a non-empty Member subset.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupJoinSchema } } },
  },
  responses: {
    "200": {
      description: "The active capacity set after the idempotent join.",
      content: { "application/json": { schema: groupMembershipMutationResponseSchema } },
    },
    "403": jsonErrorResponse("No selected capacity is eligible for this group."),
    "409": jsonErrorResponse("Parent membership or current representation is missing."),
  },
};

export const groupLeaveRouteSchema = {
  tags: ["Groups"],
  summary: "Leave selected capacities or the whole group",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupLeaveSchema } } },
  },
  responses: {
    "200": {
      description: "Remaining and ended capacities.",
      content: { "application/json": { schema: groupMembershipMutationResponseSchema } },
    },
  },
};

export const groupAutomaticEnrollmentPreferenceRouteSchema = {
  tags: ["Groups"],
  summary: "Opt out of or re-enter automatic enrollment",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupAutomaticEnrollmentPreferenceSchema } } },
  },
  responses: {
    "200": {
      description: "Automatic-enrollment preference updated.",
      content: { "application/json": { schema: groupAutomaticEnrollmentPreferenceResponseSchema } },
    },
    "409": jsonErrorResponse("The group does not permit automatic-enrollment opt-out."),
  },
};

export const groupMemberManageParamsSchema = groupReferenceParamsSchema.extend({ userId: databaseIdSchema });
export const groupMemberAddRouteSchema = {
  tags: ["Groups"],
  summary: "Add group membership capacities for another user",
  request: {
    params: groupMemberManageParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupMemberAddSchema.omit({ userId: true }) } } },
  },
  responses: {
    "200": {
      description: "Updated capacities.",
      content: { "application/json": { schema: groupMembershipMutationResponseSchema } },
    },
    "403": jsonErrorResponse("The caller may not manage this group or the target is ineligible."),
  },
};

export const groupMembershipEndRouteSchema = {
  tags: ["Groups"],
  summary: "End one group membership capacity",
  request: { params: groupMembershipParamsSchema },
  responses: {
    "200": {
      description: "Capacity ended.",
      content: { "application/json": { schema: groupMembershipMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Membership capacity not found."),
  },
};

export const groupLeadershipListRouteSchema = {
  tags: ["Groups"],
  summary: "List effective local and inherited group leadership",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": {
      description: "Effective leadership.",
      content: { "application/json": { schema: groupLeadershipListResponseSchema } },
    },
  },
};

export const groupLeadershipAssignRouteSchema = {
  tags: ["Groups"],
  summary: "Assign local group leadership",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupLeadershipAssignSchema } } },
  },
  responses: {
    "201": { description: "Leadership assigned." },
    "403": jsonErrorResponse("Assignment is not authorized."),
  },
};

export const groupCategoryRulesReplaceRouteSchema = {
  tags: ["Groups"],
  summary: "Replace category eligibility and automatic-enrollment rules",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupCategoryRulesReplaceSchema } } },
  },
  responses: {
    "200": { description: "Rules replaced." },
    "403": jsonErrorResponse("Rule management is not authorized."),
  },
};

export const groupLeadershipAssignmentParamsSchema = groupReferenceParamsSchema.extend({
  userRoleId: databaseIdSchema,
});
export const groupLeadershipRevokeRouteSchema = {
  tags: ["Groups"],
  summary: "Revoke a local leadership assignment",
  request: { params: groupLeadershipAssignmentParamsSchema },
  responses: {
    "200": { description: "Leadership revoked." },
    "409": jsonErrorResponse("Local-only governance requires local leadership."),
  },
};
