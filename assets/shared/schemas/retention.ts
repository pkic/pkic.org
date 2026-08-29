import { z } from "zod";
import { jsonErrorResponse, successResponseSchema } from "./api-common";
import { pendingWorkListQuerySchema, pendingWorkListResponseSchema } from "./pending-work";

/**
 * Data retention is its own governance domain: `retention_policies` decides how
 * long identifying registration and user data is kept, independently of the
 * events and members that data belongs to.
 */
export const RETENTION_RUN_MODES = ["preview", "execute"] as const;
export const retentionRunModeSchema = z.enum(RETENTION_RUN_MODES);

export const retentionRunCreateSchema = z
  .object({ mode: retentionRunModeSchema.default("execute") })
  .default({ mode: "execute" });
export type RetentionRunCreate = z.infer<typeof retentionRunCreateSchema>;

export const retentionRunResponseSchema = successResponseSchema.extend({
  mode: retentionRunModeSchema,
  redactedRegistrations: z.number(),
  redactedUsers: z.number(),
  affectedEvents: z.number(),
});
export type RetentionRunResponse = z.infer<typeof retentionRunResponseSchema>;

export const retentionDueListQuerySchema = pendingWorkListQuerySchema;
export const retentionDueListResponseSchema = pendingWorkListResponseSchema;

export const retentionDueListRouteSchema = {
  tags: ["Retention"],
  "x-pkic-auth": { required: true, scopes: ["retention:read"] },
  summary: "List records due for retention redaction",
  description:
    "Returns the events whose configured retention window has elapsed and whose identifying registration data has not yet been redacted. Search, sorting, counting, and pagination run in D1.",
  request: { query: retentionDueListQuerySchema },
  responses: {
    "200": {
      description: "Due retention page.",
      content: { "application/json": { schema: retentionDueListResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to read retention work."),
  },
};

export const retentionRunCreateRouteSchema = {
  tags: ["Retention"],
  "x-pkic-auth": { required: true, scopes: ["retention:run"] },
  summary: "Create a retention run",
  description:
    "Applies the configured retention policies, redacting identifying registration and user data whose window has elapsed. Requires `users:anonymize` in addition to `retention:run`, and re-evaluates both inside the same D1 batch as the redaction and its audit record.",
  request: {
    body: { required: false, content: { "application/json": { schema: retentionRunCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Retention run result.",
      content: { "application/json": { schema: retentionRunResponseSchema } },
    },
    "401": jsonErrorResponse("Staff session required."),
    "403": jsonErrorResponse("Insufficient permission to run retention."),
    "409": jsonErrorResponse("Retention permission changed while the run was in progress."),
  },
};
