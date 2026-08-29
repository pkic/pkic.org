import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";
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
  ...requiresPermissions("retention:read"),
  summary: "List records due for retention redaction",
  description:
    "Returns the events whose configured retention window has elapsed and whose identifying registration data has not yet been redacted. Search, sorting, counting, and pagination run in D1.",
  request: { query: retentionDueListQuerySchema },
  responses: {
    ...ok("Due retention page.", retentionDueListResponseSchema),
    ...authErrors({ forbidden: "Requires retention:read." }),
  },
};

export const retentionRunCreateRouteSchema = {
  tags: ["Retention"],
  ...requiresPermissions("retention:run"),
  summary: "Create a retention run",
  description:
    "Applies the configured retention policies, redacting identifying registration and user data whose window has elapsed. Requires `users:anonymize` in addition to `retention:run`, and re-evaluates both inside the same D1 batch as the redaction and its audit record.",
  request: {
    body: { required: false, content: { "application/json": { schema: retentionRunCreateSchema } } },
  },
  responses: {
    ...ok("Retention run result.", retentionRunResponseSchema),
    ...authErrors({
      forbidden: "Requires retention:run and users:anonymize.",
      conflict: "Retention permission changed while the run was in progress.",
    }),
  },
};
