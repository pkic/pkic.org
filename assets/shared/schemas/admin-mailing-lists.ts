/**
 * Managed mailing list configuration. Admin role required
 * enforced by the legacy AUTH_SCOPES gate (functions/api/v1/admin/router.ts's
 * enforceAdminScopes), same as the Users list, not a named
 * permission.
 */
import { z } from "zod";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const MAILING_LIST_TYPES = ["all_members", "consultation", "ec", "working_group", "custom"] as const;
export const mailingListTypeSchema = z.enum(MAILING_LIST_TYPES);

export const mailingListSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  label: z.string(),
  listType: mailingListTypeSchema,
  workingGroupId: z.uuid().nullable(),
  autoSyncCategories: z.array(z.string()).nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mailingListsListRouteSchema = {
  tags: ["Mailing Lists"],
  summary: "List all managed mailing lists",
  responses: {
    "200": {
      description: "Mailing lists.",
      content: { "application/json": { schema: z.object({ mailingLists: z.array(mailingListSchema) }) } },
    },
  },
};

export const mailingListCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  label: trimmedString(1, 200),
  listType: mailingListTypeSchema,
  workingGroupId: z.uuid().nullable().optional(),
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

export const mailingListIdParamsSchema = z.object({ id: z.uuid() });

export const mailingListUpdateSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  label: trimmedString(1, 200).optional(),
  listType: mailingListTypeSchema.optional(),
  workingGroupId: z.uuid().nullable().optional(),
  autoSyncCategories: z.array(z.string()).nullable().optional(),
  active: z.boolean().optional(),
});

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
          schema: z.object({
            processed: z.number(),
            succeeded: z.number(),
            failed: z.number(),
            skippedUnconfigured: z.boolean(),
          }),
        },
      },
    },
  },
};
