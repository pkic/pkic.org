import { z } from "zod";
import { booleanQueryFlagSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const ADMIN_DUE_WORK_SORT_COLUMNS = ["dueAt", "title", "typeLabel"] as const;
export const adminDueWorkBucketSchema = z.enum(["all", "outbox", "reminders", "cleanup"]);

export const adminDueWorkListQuerySchema = listQuerySchema(ADMIN_DUE_WORK_SORT_COLUMNS, { limit: 25 }).extend({
  bucket: adminDueWorkBucketSchema.default("all"),
  includeRetention: booleanQueryFlagSchema.default(false),
  reminderLimit: z.coerce.number().int().min(1).max(500).default(120),
  outboxLimit: z.coerce.number().int().min(1).max(500).default(120),
  cleanupLimit: z.coerce.number().int().min(1).max(500).default(120),
});
export type AdminDueWorkListQuery = z.infer<typeof adminDueWorkListQuerySchema>;

export const adminDueWorkRowSchema = z.object({
  bucket: adminDueWorkBucketSchema.exclude(["all"]),
  typeLabel: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  context: z.string(),
  detail: z.string().nullable(),
  dueAt: z.string().nullable(),
  statusKey: z.string(),
  statusLabel: z.string(),
});

export type AdminDueWorkRow = z.infer<typeof adminDueWorkRowSchema>;
export type AdminDueWorkTab = z.infer<typeof adminDueWorkBucketSchema>;

export const adminDueWorkCountsSchema = z.object({
  all: z.number(),
  outbox: z.number(),
  reminders: z.number(),
  cleanup: z.number(),
});

export const adminDueWorkListResponseSchema = paginatedResponseSchema("items", adminDueWorkRowSchema).extend({
  counts: adminDueWorkCountsSchema,
});

export type AdminDueWorkListResponse = z.infer<typeof adminDueWorkListResponseSchema>;

export const adminDueWorkListRouteSchema = {
  tags: ["Admin due work"],
  summary: "List the bounded due-work batch",
  description:
    "Returns one server-owned, filterable/sortable/pageable projection of due outbox, reminder, and optional retention work. Each source has an explicit candidate limit so historical D1 data is not joined into an unbounded Worker read model.",
  request: { query: adminDueWorkListQuerySchema },
  responses: {
    "200": {
      description: "Bounded due-work page and server-computed bucket counts.",
      content: { "application/json": { schema: adminDueWorkListResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
  },
};
