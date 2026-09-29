/**
 * What an organization's representatives do across the system — the account
 * record's cross-links.
 *
 * The organization page is a CRM account record: who the organization is, who
 * represents it, and then what those representatives have done elsewhere. The
 * three collections here answer that last question, each as a read model over
 * existing tables, and each bounded to the organization by the same set: the
 * users behind its ACTIVE identities.
 *
 * Every query composes the shared list contract (pagination, search, sort)
 * from `./pagination` and every response the shared page envelope, so these
 * are the same dialect as every other listing endpoint rather than a third
 * one invented for an account page.
 *
 * Stored instants are transported as they are persisted (`z.string()`), the
 * convention every read model over these legacy columns already follows —
 * `events.starts_at`, `group_memberships.joined_at`, and
 * `session_proposals.submitted_at` predate the ms-precision UTC codec and
 * carry rows written before it.
 */
import { z } from "zod";
import { eventIdSchema, trimmedString } from "./api-common";
import { groupIdSchema, groupSlugSchema, groupTypeKeySchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { organizationManagementParamsSchema } from "./organization-management";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchemaWithDefault } from "./pagination";
import { eventParticipantRoleSchema } from "./participant-roles";
import { proposalAdminStatusFilterSchema, proposalStatusSchema } from "./proposal-status";
import { ok, authErrors, requiresPermissions } from "./route-contract";

/** Every activity collection is addressed by the organization it belongs to. */
export const organizationActivityParamsSchema = organizationManagementParamsSchema;

/* ── Groups the organization is represented in ─────────────────────────── */

export const ORGANIZATION_GROUPS_SORT_COLUMNS = ["name", "representativeCount", "latestJoinedAt"] as const;

export const organizationGroupsListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(ORGANIZATION_GROUPS_SORT_COLUMNS, "name"),
);
export type OrganizationGroupsListQuery = z.infer<typeof organizationGroupsListQuerySchema>;

export const organizationGroupParticipationSchema = z.object({
  groupId: groupIdSchema,
  groupSlug: groupSlugSchema,
  groupName: trimmedString(1, 200),
  /** `groups.type_key`: the configured group type, which is the table's only notion of kind. */
  groupKind: groupTypeKeySchema,
  /**
   * The type's display name, from the `group_types` reference table that owns
   * it. Carried beside the key so a reader sees "Working Group" without the
   * frontend inventing a label the reference data already holds.
   */
  groupKindLabel: trimmedString(1, 80),
  /** Distinct active identities of this organization holding a capacity in the group. */
  representativeCount: z.number().int().min(1),
  firstJoinedAt: z.string(),
  latestJoinedAt: z.string(),
});
export type OrganizationGroupParticipation = z.infer<typeof organizationGroupParticipationSchema>;

export const organizationGroupsListResponseSchema = paginatedResponseSchema(
  "groups",
  organizationGroupParticipationSchema,
);
export type OrganizationGroupsListResponse = z.infer<typeof organizationGroupsListResponseSchema>;

/* ── Events the organization's representatives took part in ────────────── */

export const ORGANIZATION_EVENTS_SORT_COLUMNS = ["startsAt", "eventName", "registrationCount"] as const;

export const ORGANIZATION_EVENT_WHEN_VALUES = ["upcoming", "past"] as const;
export const organizationEventWhenSchema = z.enum(ORGANIZATION_EVENT_WHEN_VALUES);
export type OrganizationEventWhen = z.infer<typeof organizationEventWhenSchema>;

export const organizationEventsListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(ORGANIZATION_EVENTS_SORT_COLUMNS, "-startsAt"),
).extend({
  when: organizationEventWhenSchema.optional(),
});
export type OrganizationEventsListQuery = z.infer<typeof organizationEventsListQuerySchema>;

export const organizationEventParticipationSchema = z.object({
  eventId: eventIdSchema,
  eventSlug: z.string(),
  eventName: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  /** Distinct users of this organization holding a non-cancelled registration. */
  registrationCount: z.number().int().min(0),
  /** Distinct active participant roles held by this organization's users, in vocabulary order. */
  participantRoles: z.array(eventParticipantRoleSchema),
  /**
   * Whether the event has not finished yet. An event with neither a start nor
   * an end instant is unscheduled: it is not upcoming, and the `when` filter
   * excludes it from both sides rather than guessing.
   */
  upcoming: z.boolean(),
});
export type OrganizationEventParticipation = z.infer<typeof organizationEventParticipationSchema>;

export const organizationEventsListResponseSchema = paginatedResponseSchema(
  "events",
  organizationEventParticipationSchema,
);
export type OrganizationEventsListResponse = z.infer<typeof organizationEventsListResponseSchema>;

/* ── Session proposals submitted by the organization's representatives ─── */

export const ORGANIZATION_PROPOSALS_SORT_COLUMNS = ["submittedAt", "title", "status"] as const;

export const organizationProposalsListQuerySchema = searchableListQuerySchema(
  sortColumnSchemaWithDefault(ORGANIZATION_PROPOSALS_SORT_COLUMNS, "-submittedAt"),
).extend({
  // The canonical program-catalogue status vocabulary, including its `active`
  // aggregate. Not redefined here: a proposal has one status vocabulary.
  status: proposalAdminStatusFilterSchema.optional(),
});
export type OrganizationProposalsListQuery = z.infer<typeof organizationProposalsListQuerySchema>;

export const organizationProposalSchema = z.object({
  proposalId: databaseIdSchema,
  eventSlug: z.string(),
  eventName: z.string(),
  title: z.string(),
  proposalType: z.string(),
  status: proposalStatusSchema,
  submittedAt: z.string(),
  proposerName: z.string(),
  proposerEmail: z.string(),
});
export type OrganizationProposal = z.infer<typeof organizationProposalSchema>;

export const organizationProposalsListResponseSchema = paginatedResponseSchema("proposals", organizationProposalSchema);
export type OrganizationProposalsListResponse = z.infer<typeof organizationProposalsListResponseSchema>;

/* ── Route contracts ───────────────────────────────────────────────────── */

// An organization that does not exist has no activity, so every collection
// answers with an empty page rather than a 404. The record's own detail GET is
// what tells a reader the account is gone; three tabs repeating it would not.
const ACTIVITY_FORBIDDEN = "The organizations:read permission is required.";

export const organizationGroupsListRouteSchema = {
  ...requiresPermissions("organizations:read"),
  tags: ["Organizations", "Groups"],
  summary: "List the groups an organization is represented in",
  description:
    "Groups holding an active capacity for one of the organization's active identities. Filtering, search, " +
    "sorting, counting, and pagination are executed in D1.",
  request: { params: organizationActivityParamsSchema, query: organizationGroupsListQuerySchema },
  responses: {
    ...ok("A bounded page of group participation.", organizationGroupsListResponseSchema),
    ...authErrors({ forbidden: ACTIVITY_FORBIDDEN }),
  },
};

export const organizationEventsListRouteSchema = {
  ...requiresPermissions("organizations:read"),
  tags: ["Organizations", "Events"],
  summary: "List the events an organization's representatives took part in",
  description:
    "Events with a non-cancelled registration or an active participant role for one of the organization's " +
    "active identities. Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: organizationActivityParamsSchema, query: organizationEventsListQuerySchema },
  responses: {
    ...ok("A bounded page of event participation.", organizationEventsListResponseSchema),
    ...authErrors({ forbidden: ACTIVITY_FORBIDDEN }),
  },
};

export const organizationProposalsListRouteSchema = {
  ...requiresPermissions("organizations:read"),
  tags: ["Organizations", "Proposals"],
  summary: "List the session proposals an organization's representatives submitted",
  description:
    "Session proposals proposed by one of the organization's active identities. Filtering, search, sorting, " +
    "counting, and pagination are executed in D1.",
  request: { params: organizationActivityParamsSchema, query: organizationProposalsListQuerySchema },
  responses: {
    ...ok("A bounded page of session proposals.", organizationProposalsListResponseSchema),
    ...authErrors({ forbidden: ACTIVITY_FORBIDDEN }),
  },
};
