import { z } from "zod";
import { booleanQueryFlagSchema, successResponseSchema, trimmedString } from "./api-common";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { membershipCategorySelectionSchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresSession } from "./route-contract";
import { userCatalogItemSchema } from "./user-catalog";

export const MAILING_LIST_PURPOSES = ["all_members", "consultation", "group", "custom"] as const;
export const mailingListPurposeSchema = z.enum(MAILING_LIST_PURPOSES);
export const MAILING_LIST_SUBSCRIPTION_DEFAULTS = ["group_members", "eligible_categories", "none"] as const;
export const mailingListSubscriptionDefaultSchema = z.enum(MAILING_LIST_SUBSCRIPTION_DEFAULTS);

/**
 * Who may post to the list without the message being rejected outright.
 * Previously an unconstrained 80-character string; the vocabulary below is
 * the single source of truth so group-management UI can offer a select
 * instead of free text.
 */
export const MAILING_LIST_POSTING_POLICIES = ["anyone", "members", "subscribers", "moderators"] as const;
export const mailingListPostingPolicySchema = z.enum(MAILING_LIST_POSTING_POLICIES);
export type MailingListPostingPolicy = z.infer<typeof mailingListPostingPolicySchema>;
export const MAILING_LIST_POSTING_POLICY_LABELS = {
  anyone: "Anyone can post",
  members: "Group members only",
  subscribers: "List subscribers only",
  moderators: "Moderators only",
} as const satisfies Record<MailingListPostingPolicy, string>;

/** Whether posts are held for approval before delivery. */
export const MAILING_LIST_MODERATION_POLICIES = ["unmoderated", "moderated", "new_members_moderated"] as const;
export const mailingListModerationPolicySchema = z.enum(MAILING_LIST_MODERATION_POLICIES);
export type MailingListModerationPolicy = z.infer<typeof mailingListModerationPolicySchema>;
export const MAILING_LIST_MODERATION_POLICY_LABELS = {
  unmoderated: "Unmoderated — posts are delivered immediately",
  moderated: "Moderated — every post requires approval",
  new_members_moderated: "New members moderated, existing members unmoderated",
} as const satisfies Record<MailingListModerationPolicy, string>;
/**
 * What a member may choose for one list. `inherit` is not a stored preference
 * but the absence of one: it hands the list back to the group's own default,
 * which is why a subscription row only ever holds the other two.
 */
export const MAILING_LIST_PREFERENCE_SELECTIONS = ["inherit", "subscribed", "unsubscribed"] as const;
export const mailingListPreferenceSelectionSchema = z.enum(MAILING_LIST_PREFERENCE_SELECTIONS);
export type MailingListPreferenceSelection = z.infer<typeof mailingListPreferenceSelectionSchema>;
export const mailingListPreferenceSchema = mailingListPreferenceSelectionSchema.exclude(["inherit"]);
export const mailingListPreferenceMutationSchema = z.object({
  preference: mailingListPreferenceSelectionSchema,
});
export type MailingListPreferenceMutationInput = z.infer<typeof mailingListPreferenceMutationSchema>;

export const mailingListSchema = z.object({
  id: databaseIdSchema,
  email: z.email(),
  label: trimmedString(1, 200),
  purpose: mailingListPurposeSchema,
  groupId: groupIdSchema,
  primaryDiscussion: z.boolean(),
  subscriptionDefault: mailingListSubscriptionDefaultSchema,
  postingPolicy: mailingListPostingPolicySchema,
  moderationPolicy: mailingListModerationPolicySchema,
  autoSyncCategories: membershipCategorySelectionSchema.nullable(),
  active: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MailingList = z.infer<typeof mailingListSchema>;

export const MAILING_LIST_SORT_COLUMNS = ["email", "label", "purpose", "active", "created_at"] as const;
export const mailingListsListQuerySchema = listQuerySchema(MAILING_LIST_SORT_COLUMNS).extend({
  purpose: mailingListPurposeSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  primaryDiscussion: booleanQueryFlagSchema.optional(),
});
export type MailingListsListQuery = z.infer<typeof mailingListsListQuerySchema>;
export const mailingListsListResponseSchema = paginatedResponseSchema("mailingLists", mailingListSchema);
export const mailingListResponseSchema = z.object({ mailingList: mailingListSchema });
export type MailingListsListResponse = z.infer<typeof mailingListsListResponseSchema>;

const mailingListMutableFieldsSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  label: trimmedString(1, 200),
  purpose: mailingListPurposeSchema,
  primaryDiscussion: z.boolean().optional(),
  subscriptionDefault: mailingListSubscriptionDefaultSchema.optional(),
  postingPolicy: mailingListPostingPolicySchema.optional(),
  moderationPolicy: mailingListModerationPolicySchema.optional(),
  autoSyncCategories: membershipCategorySelectionSchema.nullable().optional(),
  active: z.boolean().optional(),
});
/**
 * Group managers configure only the list itself. Ownership is derived from the
 * selected group route and is deliberately not accepted from the request
 * body, so a nested mutation cannot move a list between groups.
 */
export const groupMailingListCreateSchema = mailingListMutableFieldsSchema.strict();
export type GroupMailingListCreateInput = z.infer<typeof groupMailingListCreateSchema>;
export const groupMailingListUpdateSchema = mailingListMutableFieldsSchema.partial().strict();
export type GroupMailingListUpdateInput = z.infer<typeof groupMailingListUpdateSchema>;

export const groupMailingListParamsSchema = groupReferenceParamsSchema.extend({ listId: databaseIdSchema });

export const effectiveMailingListSubscriptionSchema = z.object({
  mailingList: mailingListSchema,
  eligible: z.boolean(),
  defaultSubscribed: z.boolean(),
  preference: mailingListPreferenceSchema.nullable(),
  effectiveSubscribed: z.boolean(),
});
export type EffectiveMailingListSubscription = z.infer<typeof effectiveMailingListSubscriptionSchema>;
export const effectiveMailingListSubscriptionsResponseSchema = paginatedResponseSchema(
  "subscriptions",
  effectiveMailingListSubscriptionSchema,
);
export const groupMailingListSubscriptionsQuerySchema = mailingListsListQuerySchema;
export type GroupMailingListSubscriptionsQuery = z.infer<typeof groupMailingListSubscriptionsQuerySchema>;
export const groupMailingListManagementQuerySchema = groupMailingListSubscriptionsQuerySchema;
export type GroupMailingListManagementQuery = z.infer<typeof groupMailingListManagementQuerySchema>;
export const mailingListPreferenceMutationResponseSchema = successResponseSchema.extend({
  subscription: effectiveMailingListSubscriptionSchema,
});

export const groupMailingListCreateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Create a mailing list owned by a group",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupMailingListCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Group mailing list created.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
  },
};

export const groupMailingListUpdateRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Update a group-owned mailing list",
  request: {
    params: groupMailingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupMailingListUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Group mailing list updated.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
  },
};

export const groupMailingListManagementRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List mailing-list configurations managed by a group",
  description: "Search, filtering, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: groupMailingListManagementQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of group-owned mailing-list configurations.",
      content: { "application/json": { schema: mailingListsListResponseSchema } },
    },
  },
};

export const groupMailingListSubscriptionsRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List the caller's effective subscriptions for one group",
  request: { params: groupReferenceParamsSchema, query: groupMailingListSubscriptionsQuerySchema },
  responses: {
    "200": {
      description: "A bounded effective-subscription page.",
      content: { "application/json": { schema: effectiveMailingListSubscriptionsResponseSchema } },
    },
  },
};

export const groupMailingListPreferenceRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Set or clear the caller's subscription preference",
  request: {
    params: groupMailingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: mailingListPreferenceMutationSchema } } },
  },
  responses: {
    "200": {
      description: "Effective subscription after the preference change.",
      content: { "application/json": { schema: mailingListPreferenceMutationResponseSchema } },
    },
  },
};

/**
 * The two directions of a list's lifecycle. Archiving is a state a list can
 * come back from, so the vocabulary names both moves rather than treating
 * the return trip as an ordinary field edit.
 */
export const MAILING_LIST_LIFECYCLE_TRANSITIONS = ["archive", "restore"] as const;
export const mailingListLifecycleTransitionSchema = z
  .object({ transition: z.enum(MAILING_LIST_LIFECYCLE_TRANSITIONS) })
  .strict();
export type MailingListLifecycleTransitionInput = z.infer<typeof mailingListLifecycleTransitionSchema>;

export const groupMailingListGetRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Read one group-owned mailing list",
  request: { params: groupMailingListParamsSchema },
  responses: {
    "200": {
      description: "The mailing-list configuration.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
    "404": { description: "Mailing list not found through this group." },
  },
};

export const groupMailingListTransitionRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Archive or restore a group-owned mailing list",
  description:
    "Archiving retires the list without losing its configuration, subscription history, or the external list; restoring puts it back into service.",
  request: {
    params: groupMailingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: mailingListLifecycleTransitionSchema } } },
  },
  responses: {
    "200": {
      description: "The mailing list after the transition.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
    "409": { description: "The group already has an active primary discussion list." },
  },
};

export const groupMailingListDeleteRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Delete a group-owned mailing list that need not be retained",
  description:
    "Refused while anything depends on the list: a recorded subscription preference, a share with another group, or membership already synced to the external list. Those lists are archived instead.",
  request: { params: groupMailingListParamsSchema },
  responses: {
    "200": { description: "The mailing list was deleted." },
    "409": { description: "The mailing list carries history or is still depended on." },
  },
};

/**
 * One person's standing on one list. The shape mirrors
 * `effectiveMailingListSubscriptionSchema` — eligibility, the stored
 * preference, the list default, and what those add up to — read across the
 * roster of a single list instead of down one member's lists.
 */
export const mailingListSubscriberSchema = z.object({
  user: userCatalogItemSchema,
  eligible: z.boolean(),
  defaultSubscribed: z.boolean(),
  preference: mailingListPreferenceSchema.nullable(),
  subscribed: z.boolean(),
});
export type MailingListSubscriber = z.infer<typeof mailingListSubscriberSchema>;

export const MAILING_LIST_SUBSCRIBER_SORT_COLUMNS = ["email", "first_name", "last_name", "subscribed"] as const;
export const mailingListSubscribersListQuerySchema = listQuerySchema(MAILING_LIST_SUBSCRIBER_SORT_COLUMNS).extend({
  subscribed: booleanQueryFlagSchema.optional(),
});
export type MailingListSubscribersListQuery = z.infer<typeof mailingListSubscribersListQuerySchema>;
export const mailingListSubscribersResponseSchema = paginatedResponseSchema("subscribers", mailingListSubscriberSchema);

export const groupMailingListSubscribersRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "List who receives one group-owned mailing list",
  description: "Search, filtering, sorting, counting, and pagination are executed in D1.",
  request: { params: groupMailingListParamsSchema, query: mailingListSubscribersListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of the list's subscribers.",
      content: { "application/json": { schema: mailingListSubscribersResponseSchema } },
    },
  },
};
