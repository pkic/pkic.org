import { z } from "zod";
import { booleanQueryFlagSchema, successResponseSchema, trimmedString } from "./api-common";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { membershipCategorySchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const MAILING_LIST_PURPOSES = ["all_members", "consultation", "group", "custom"] as const;
export const mailingListPurposeSchema = z.enum(MAILING_LIST_PURPOSES);
export const MAILING_LIST_SUBSCRIPTION_DEFAULTS = ["group_members", "eligible_categories", "none"] as const;
export const mailingListSubscriptionDefaultSchema = z.enum(MAILING_LIST_SUBSCRIPTION_DEFAULTS);
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
  postingPolicy: trimmedString(1, 80),
  moderationPolicy: trimmedString(1, 80),
  autoSyncCategories: z.array(membershipCategorySchema).nullable(),
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
  postingPolicy: trimmedString(1, 80).optional(),
  moderationPolicy: trimmedString(1, 80).optional(),
  autoSyncCategories: z.array(membershipCategorySchema).max(50).nullable().optional(),
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
  tags: ["Groups"],
  summary: "Archive a group-owned mailing list",
  description: "Archives the configuration without deleting subscription history or the external list.",
  request: { params: groupMailingListParamsSchema },
  responses: { "200": { description: "Group mailing list archived." } },
};

export const groupMailingListManagementRouteSchema = {
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
