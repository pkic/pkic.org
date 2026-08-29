import { z } from "zod";
import { jsonErrorResponse, successResponseSchema } from "./api-common";

/**
 * Membership workflow batches. The batch key is a path parameter validated
 * against this catalog, so adding a batch does not add a route family.
 */
export const MEMBERSHIP_BATCH_KEYS = ["consultation", "ec-review", "wg-chair-digest"] as const;
export const membershipBatchKeySchema = z.enum(MEMBERSHIP_BATCH_KEYS);
export type MembershipBatchKey = z.infer<typeof membershipBatchKeySchema>;

export const membershipBatchParamsSchema = z.object({ batchKey: membershipBatchKeySchema });

export const membershipBatchRunCreateSchema = z.object({}).default({});

export const membershipBatchRunResponseSchema = successResponseSchema.extend({
  batchKey: membershipBatchKeySchema,
  applicationsNotified: z.number().optional(),
  transitioned: z.number().optional(),
  workingGroupsWithChanges: z.number().optional(),
  emailsSent: z.number().optional(),
});
export type MembershipBatchRunResponse = z.infer<typeof membershipBatchRunResponseSchema>;

export const membershipBatchRunCreateRouteSchema = {
  tags: ["Membership"],
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  summary: "Create a membership batch run",
  description:
    "Runs one membership workflow batch. `consultation` additionally requires `membership:write` and `ec-review` requires `membership:approve`; the exact set is re-evaluated inside the same D1 batch as the batch's own writes, audit record, and queued notifications. The run reuses the scheduled D1 query budget.",
  request: {
    params: membershipBatchParamsSchema,
    body: { required: false, content: { "application/json": { schema: membershipBatchRunCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Membership batch run result.",
      content: { "application/json": { schema: membershipBatchRunResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to run this membership batch."),
    "409": jsonErrorResponse("Membership permission changed while the run was in progress."),
  },
};
