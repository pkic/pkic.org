import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { trimmedString } from "./api-common";
import { membershipWorkflowVersionSchema } from "./membership-workflows";
import { authErrors, ok, requiresPermissions } from "./route-contract";
export const membershipWorkflowMigrationPreviewSchema = z.object({ versionId: databaseIdSchema });
export const membershipWorkflowMigrationSchema = membershipWorkflowMigrationPreviewSchema.extend({
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: trimmedString(3, 2000),
  acknowledgeRestart: z.literal(true, {
    error: "Confirm that all required reviews will restart with full response windows.",
  }),
});
export const membershipWorkflowMigrationPreviewResponseSchema = z.object({
  fingerprint: z.string(),
  applicationId: databaseIdSchema,
  fromVersionId: databaseIdSchema.nullable(),
  target: membershipWorkflowVersionSchema,
  generation: z.number().int().positive(),
  currentStage: z.string(),
  unresolvedObjections: z.number().int().nonnegative(),
  paidFees: z.number().int().nonnegative(),
  effect: z.string(),
});
export const membershipWorkflowMigrationResponseSchema = z.object({
  applicationId: databaseIdSchema,
  versionId: databaseIdSchema,
  generation: z.number().int().positive(),
});
const base = { tags: ["Membership"], ...requiresPermissions("membership:approve") };
const params = z.object({ id: databaseIdSchema });
const errors = authErrors({
  notFound: "Application or version not found.",
  conflict: "The preview or application changed.",
});
export const membershipWorkflowMigrationPreviewRouteSchema = {
  ...base,
  summary: "Preview restarting an application under a published workflow version",
  request: { params, query: membershipWorkflowMigrationPreviewSchema },
  responses: { ...ok("Exact policy migration preview.", membershipWorkflowMigrationPreviewResponseSchema), ...errors },
};
export const membershipWorkflowMigrationRouteSchema = {
  ...base,
  summary: "Apply an explicitly acknowledged membership workflow migration",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: membershipWorkflowMigrationSchema } } },
  },
  responses: { ...ok("New workflow generation pinned.", membershipWorkflowMigrationResponseSchema), ...errors },
};
