import { z } from "zod";
import { booleanQueryFlagSchema, successResponseSchema, trimmedString } from "./api-common";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { membershipCategorySelectionSchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresSession } from "./route-contract";

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
export const mailingListPreferenceSchema = z.enum(["subscribed", "unsubscribed"]);
export const mailingListPreferenceMutationSchema = z.object({
  preference: z.enum(["subscribed", "unsubscribed", "inherit"]),
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

export const groupMailingListArchiveRouteSchema = {
  ...requiresSession(),
  tags: ["Groups"],
  summary: "Archive a group-owned mailing list",
  description: "Archives the configuration without deleting subscription history or the external list.",
  request: { params: groupMailingListParamsSchema },
  responses: { "200": { description: "Group mailing list archived." } },
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
