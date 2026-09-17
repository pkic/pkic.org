import { z } from "zod";
import { groupReferenceParamsSchema } from "./groups";
import { authErrors, ok, requiresSession } from "./route-contract";
export const groupMailingSyncSettingsSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const groupMailingSyncResponseSchema = z.object({ synchronization: groupMailingSyncSettingsSchema });
export const groupMailingSyncUpdateSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
});
export const groupMailingSyncRunSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
export const groupMailingSyncRunResponseSchema = z.object({ queued: z.number().int().nonnegative() });
const common = {
  ...requiresSession(),
  tags: ["Groups"],
  responses: {
    ...ok("Google Groups synchronization settings.", groupMailingSyncResponseSchema),
    ...authErrors({ conflict: "Settings or authorization changed." }),
  },
};
export const groupMailingSyncGetRouteSchema = {
  ...common,
  summary: "Read a group's Google Groups synchronization settings",
  request: { params: groupReferenceParamsSchema },
};
export const groupMailingSyncUpdateRouteSchema = {
  ...common,
  summary: "Enable or pause a group's Google Groups synchronization",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupMailingSyncUpdateSchema } } },
  },
};
export const groupMailingSyncRunRouteSchema = {
  ...common,
  summary: "Queue reconciliation of a group's Google Groups memberships",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupMailingSyncRunSchema } } },
  },
  responses: {
    ...ok("Queued synchronization intents.", groupMailingSyncRunResponseSchema),
    ...authErrors({ conflict: "Synchronization is paused or settings changed." }),
  },
};
