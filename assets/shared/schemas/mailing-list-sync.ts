import { z } from "zod";
import { groupMailingListParamsSchema } from "./mailing-lists";
import { authErrors, ok, requiresSession } from "./route-contract";
export const mailingListSyncSettingsSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const mailingListSyncResponseSchema = z.object({ synchronization: mailingListSyncSettingsSchema });
export const mailingListSyncUpdateSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
});
export const mailingListSyncRunSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
export const mailingListSyncRunResponseSchema = z.object({ queued: z.number().int().nonnegative() });
const common = {
  ...requiresSession(),
  tags: ["Groups"],
  responses: {
    ...ok("Google Groups synchronization settings.", mailingListSyncResponseSchema),
    ...authErrors({ conflict: "Settings or authorization changed." }),
  },
};
export const mailingListSyncGetRouteSchema = {
  ...common,
  summary: "Read a mailing list's Google Groups synchronization settings",
  request: { params: groupMailingListParamsSchema },
};
export const mailingListSyncUpdateRouteSchema = {
  ...common,
  summary: "Enable or pause a mailing list's Google Groups synchronization",
  request: {
    params: groupMailingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: mailingListSyncUpdateSchema } } },
  },
};
export const mailingListSyncRunRouteSchema = {
  ...common,
  summary: "Queue reconciliation of a mailing list's Google Groups memberships",
  request: {
    params: groupMailingListParamsSchema,
    body: { required: true, content: { "application/json": { schema: mailingListSyncRunSchema } } },
  },
  responses: {
    ...ok("Queued synchronization intents.", mailingListSyncRunResponseSchema),
    ...authErrors({ conflict: "Synchronization is paused or settings changed." }),
  },
};
