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

export const mailingListSchema = z.object({
  id: databaseIdSchema,
  email: z.email(),
  label: trimmedString(1, 200),
  purpose: mailingListPurposeSchema,
  groupId: groupIdSchema.nullable(),
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
  groupId: groupIdSchema.optional(),
  purpose: mailingListPurposeSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  primaryDiscussion: booleanQueryFlagSchema.optional(),
});
export type MailingListsListQuery = z.infer<typeof mailingListsListQuerySchema>;
export const mailingListsListResponseSchema = paginatedResponseSchema("mailingLists", mailingListSchema);
export const mailingListResponseSchema = z.object({ mailingList: mailingListSchema });
export type MailingListsListResponse = z.infer<typeof mailingListsListResponseSchema>;

export const mailingListCreateSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  label: trimmedString(1, 200),
  purpose: mailingListPurposeSchema,
  groupId: groupIdSchema.nullable().optional(),
  primaryDiscussion: z.boolean().optional(),
  subscriptionDefault: mailingListSubscriptionDefaultSchema.optional(),
  postingPolicy: trimmedString(1, 80).optional(),
  moderationPolicy: trimmedString(1, 80).optional(),
  autoSyncCategories: z.array(membershipCategorySchema).max(50).nullable().optional(),
  active: z.boolean().optional(),
});
export type MailingListCreateInput = z.infer<typeof mailingListCreateSchema>;
export const mailingListUpdateSchema = mailingListCreateSchema.partial();
export type MailingListUpdateInput = z.infer<typeof mailingListUpdateSchema>;

export const mailingListIdParamsSchema = z.object({ id: databaseIdSchema });
export const groupMailingListParamsSchema = groupReferenceParamsSchema.extend({ listId: databaseIdSchema });

export const effectiveMailingListSubscriptionSchema = z.object({
  mailingList: mailingListSchema,
  eligible: z.boolean(),
  defaultSubscribed: z.boolean(),
  preference: mailingListPreferenceSchema.nullable(),
  effectiveSubscribed: z.boolean(),
});
export const effectiveMailingListSubscriptionsResponseSchema = paginatedResponseSchema(
  "subscriptions",
  effectiveMailingListSubscriptionSchema,
);
export const groupMailingListSubscriptionsQuerySchema = mailingListsListQuerySchema.omit({ groupId: true });
export type GroupMailingListSubscriptionsQuery = z.infer<typeof groupMailingListSubscriptionsQuerySchema>;
export const mailingListPreferenceMutationResponseSchema = successResponseSchema.extend({
  subscription: effectiveMailingListSubscriptionSchema,
});

export const mailingListsListRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "List managed mailing lists",
  description: "Filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { query: mailingListsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded mailing-list page.",
      content: { "application/json": { schema: mailingListsListResponseSchema } },
    },
  },
};

export const mailingListCreateRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Create a managed mailing list",
  request: { body: { required: true, content: { "application/json": { schema: mailingListCreateSchema } } } },
  responses: {
    "201": {
      description: "Mailing list created.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
  },
};

export const mailingListUpdateRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Update a managed mailing list",
  request: {
    params: mailingListIdParamsSchema,
    body: { required: true, content: { "application/json": { schema: mailingListUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Mailing list updated.",
      content: { "application/json": { schema: mailingListResponseSchema } },
    },
  },
};

export const mailingListDeleteRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Archive a managed mailing list",
  description: "The portal stops managing the list without deleting configuration or subscription history.",
  request: { params: mailingListIdParamsSchema },
  responses: { "200": { description: "Mailing list archived." } },
};

export const mailingListSyncResponseSchema = z.object({
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  skippedUnconfigured: z.boolean(),
});
export const mailingListSyncRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Process pending Google Group synchronization work",
  responses: {
    "200": {
      description: "Sync pass result.",
      content: { "application/json": { schema: mailingListSyncResponseSchema } },
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

// Temporary import compatibility while the legacy admin surface migrates.
export const MAILING_LIST_TYPES = MAILING_LIST_PURPOSES;
export const ADMIN_MAILING_LIST_SORT_COLUMNS = MAILING_LIST_SORT_COLUMNS;
