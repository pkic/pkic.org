import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Shared presentation shape for a unit of work a domain has not yet processed.
 *
 * Each domain owns and serves its own pending list — there is deliberately no
 * cross-domain endpoint. Only the row shape is shared, so an operator sees a
 * consistent table without any merged read model having to exist.
 */
export const pendingWorkRowSchema = z.object({
  typeLabel: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  context: z.string(),
  detail: z.string().nullable(),
  dueAt: z.string().nullable(),
  statusKey: z.string(),
  statusLabel: z.string(),
});
export type PendingWorkRow = z.infer<typeof pendingWorkRowSchema>;

export const PENDING_WORK_SORT_COLUMNS = ["dueAt", "title", "typeLabel"] as const;

/**
 * Every pending-work list composes the shared filter, search, sort, and
 * pagination contract. Counts are exact because each list is a single indexed
 * query within one domain, rather than a merge of independently capped windows.
 */
export const pendingWorkListQuerySchema = listQuerySchema(PENDING_WORK_SORT_COLUMNS, { limit: 25 });
export type PendingWorkListQuery = z.infer<typeof pendingWorkListQuerySchema>;

export const pendingWorkListResponseSchema = paginatedResponseSchema("items", pendingWorkRowSchema);
export type PendingWorkListResponse = z.infer<typeof pendingWorkListResponseSchema>;
