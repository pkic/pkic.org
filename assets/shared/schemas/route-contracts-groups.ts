/** OpenAPI route contracts for the canonical group boundary. */
import { jsonErrorResponse } from "./api-common";
import { scopedAuditLogListQuerySchema, scopedAuditLogResponseSchema } from "./audit-log";
import {
  groupCategoryRulesReplaceSchema,
  groupCategoryRulesResponseSchema,
  groupCreationCapabilitiesResponseSchema,
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
  groupDetailResponseSchema,
  groupReferenceParamsSchema,
  groupResponseSchema,
  groupTypesListQuerySchema,
  groupTypesListResponseSchema,
  groupUpdateSchema,
  groupsListQuerySchema,
  groupsListResponseSchema,
} from "./groups";
import { databaseIdSchema } from "./identifiers";
import { publicOperation, requiresSession } from "./route-contract";

export const groupTypesListRouteSchema = {
  ...publicOperation(),
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

export const groupCreationCapabilitiesRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Resolve whether the current identity may create a top-level group",
  responses: {
    "200": {
      description: "Current server-derived group creation capability.",
      content: { "application/json": { schema: groupCreationCapabilitiesResponseSchema } },
    },
  },
};

export const groupsListRouteSchema = {
  ...publicOperation(),
  tags: ["Groups"],
  summary: "List groups visible to the caller",
  description:
    "Search, filtering, sorting, counting, pagination, and the optional manageable projection are executed in D1.",
  request: { query: groupsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded group page.",
      content: { "application/json": { schema: groupsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated management identity is required for the manageable projection."),
  },
};

export const groupGetRouteSchema = {
  ...publicOperation(),
  tags: ["Groups"],
  summary: "Get one group with caller-appropriate detail",
  description:
    "Public callers receive a data-minimized group projection. Authenticated callers receive the visible group and their live view, participation, and management capabilities.",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": {
      description: "Group detail scoped to the caller.",
      content: { "application/json": { schema: groupDetailResponseSchema } },
    },
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupCreateRouteSchema = {
  ...requiresSession(),
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
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Update a group",
  description: "Send expectedRevision from the group response to reject an edit based on stale state.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupUpdateSchema } } },
  },
  responses: {
    "200": { description: "Group updated.", content: { "application/json": { schema: groupResponseSchema } } },
    "403": jsonErrorResponse("The caller lacks effective management permission."),
    "409": jsonErrorResponse("The group changed before commit, or the update would create an invalid hierarchy."),
  },
};

export const groupMembershipsListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List group membership capacities",
  description:
    "One row is one user participating for one Member; a user may appear more than once. An effective group " +
    "manager receives the full capacity roster; a caller with only the participate capability receives the " +
    "privacy-reduced roster (name, headshot, and organization only — no email, category, source, or " +
    "membership-capacity identifier).",
  request: { params: groupReferenceParamsSchema, query: groupMembershipsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded membership-capacity page, shaped by the caller's own capabilities.",
      content: { "application/json": { schema: groupMembershipsListResponseSchema } },
    },
    "403": jsonErrorResponse("The caller holds neither the participate nor the manage capability for this group."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupJoinRouteSchema = {
  ...requiresSession(),
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
    "409": jsonErrorResponse("Group eligibility or capacity changed before commit."),
  },
};

export const groupLeaveRouteSchema = {
  ...requiresSession(),
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
    "409": jsonErrorResponse("Group membership changed before the leave committed."),
  },
};

export const groupAutomaticEnrollmentPreferenceRouteSchema = {
  ...requiresSession(),
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
  ...requiresSession(),
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
    "409": jsonErrorResponse("Group eligibility or capacity changed before commit."),
  },
};

export const groupMembershipEndRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "End one group membership capacity",
  request: { params: groupMembershipParamsSchema },
  responses: {
    "200": {
      description: "Capacity ended.",
      content: { "application/json": { schema: groupMembershipMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Membership capacity not found."),
    "409": jsonErrorResponse("Group membership changed before the command committed."),
  },
};

export const groupLeadershipListRouteSchema = {
  ...requiresSession(),
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
  ...requiresSession(),
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
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Replace category eligibility and automatic-enrollment rules",
  description: "Send expectedRevision from the group response to reject a replacement based on stale state.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupCategoryRulesReplaceSchema } } },
  },
  responses: {
    "200": {
      description: "Rules replaced and the updated aggregate revision returned.",
      content: { "application/json": { schema: groupResponseSchema } },
    },
    "403": jsonErrorResponse("Rule management is not authorized."),
    "409": jsonErrorResponse("The group changed before the replacement committed."),
  },
};

export const groupCategoryRulesGetRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Get category eligibility and automatic-enrollment rules",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": {
      description: "Current category rules and group revision.",
      content: { "application/json": { schema: groupCategoryRulesResponseSchema } },
    },
    "403": jsonErrorResponse("Rule management is not authorized."),
    "404": jsonErrorResponse("Group not found."),
  },
};

export const groupLeadershipAssignmentParamsSchema = groupReferenceParamsSchema.extend({
  userRoleId: databaseIdSchema,
});
export const groupLeadershipRevokeRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Revoke a local leadership assignment",
  request: { params: groupLeadershipAssignmentParamsSchema },
  responses: {
    "200": { description: "Leadership revoked." },
    "409": jsonErrorResponse("Local-only governance requires local leadership."),
  },
};

export const groupAuditLogListRouteSchema = {
  ...requiresSession(),
  tags: ["Groups", "Audit log"],
  summary: "List audit entries scoped to one group",
  description: "Exact filters, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: scopedAuditLogListQuerySchema },
  responses: {
    "200": {
      description: "A bounded group audit page.",
      content: { "application/json": { schema: scopedAuditLogResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated management identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "404": jsonErrorResponse("Group not found."),
  },
};
