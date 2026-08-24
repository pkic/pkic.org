/**
 * Managed mailing list configuration. Admin role required
 * enforced by the legacy AUTH_SCOPES gate (functions/api/v1/admin/router.ts's
 * enforceAdminScopes), same as the Users list, not a named
 * permission.
 */
import { z } from "zod";
import { trimmedString } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { groupIdSchema } from "./groups";

export const MAILING_LIST_TYPES = ["all_members", "consultation", "ec", "working_group", "custom"] as const;
export const mailingListTypeSchema = z.enum(MAILING_LIST_TYPES);

export const mailingListSchema = z.object({
  // Seeded configuration rows use stable human-readable ids (for example
  // ml-all-members); user-created rows use UUIDs. Both are canonical D1 ids.
  id: z.string().trim().min(1).max(100),
  email: z.string(),
  label: z.string(),
  listType: mailingListTypeSchema,
  workingGroupId: groupIdSchema.nullable(),
  autoSyncCategories: z.array(z.string()).nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MailingList = z.infer<typeof mailingListSchema>;

export const ADMIN_MAILING_LIST_SORT_COLUMNS = ["email", "label", "list_type", "active", "created_at"] as const;
export const mailingListsListQuerySchema = listQuerySchema(ADMIN_MAILING_LIST_SORT_COLUMNS);
export type MailingListsListQuery = z.infer<typeof mailingListsListQuerySchema>;
export const mailingListsListResponseSchema = paginatedResponseSchema("mailingLists", mailingListSchema);
export const mailingListResponseSchema = z.object({ mailingList: mailingListSchema });
export type MailingListsListResponse = z.infer<typeof mailingListsListResponseSchema>;

export const mailingListsListRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "List all managed mailing lists",
  request: { query: mailingListsListQuerySchema },
  responses: {
    "200": {
      description: "Mailing lists.",
      content: { "application/json": { schema: mailingListsListResponseSchema } },
    },
  },
};

export const mailingListCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  label: trimmedString(1, 200),
  listType: mailingListTypeSchema,
  workingGroupId: groupIdSchema.nullable().optional(),
  autoSyncCategories: z.array(z.string()).nullable().optional(),
  active: z.boolean().optional(),
});

export const mailingListCreateRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Add a new mailing list",
  description: "Immediately available for sync once active.",
  request: {
    body: { content: { "application/json": { schema: mailingListCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Created.",
      content: { "application/json": { schema: z.object({ mailingList: mailingListSchema }) } },
    },
    "409": { description: "A mailing list with that email already exists." },
  },
};

export const mailingListIdParamsSchema = z.object({ id: z.string().trim().min(1).max(100) });

export const mailingListUpdateSchema = mailingListCreateSchema.partial();

export const mailingListUpdateRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Edit a mailing list's label/type/category rules/associated WG/active state",
  request: {
    params: mailingListIdParamsSchema,
    body: { content: { "application/json": { schema: mailingListUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated.",
      content: { "application/json": { schema: z.object({ mailingList: mailingListSchema }) } },
    },
    "404": { description: "Mailing list not found." },
    "409": { description: "A mailing list with that email already exists." },
  },
};

export const mailingListDeleteRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Delete a mailing list entry",
  description: "The portal stops managing it; the Google Group itself is not deleted.",
  request: { params: mailingListIdParamsSchema },
  responses: {
    "200": { description: "Deleted." },
    "404": { description: "Mailing list not found." },
  },
};

export const mailingListSyncResponseSchema = z.object({
  processed: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  skippedUnconfigured: z.boolean(),
});

export const mailingListSyncRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "Process pending Google Group sync queue entries on demand",
  description:
    "Normally runs off the 15-minute due-work cron; this lets staff trigger a pass immediately instead of waiting.",
  responses: {
    "200": {
      description: "Sync pass result.",
      content: {
        "application/json": {
          schema: mailingListSyncResponseSchema,
        },
      },
    },
  },
};
