import { z } from "zod";
import { normalizedEmailSchema, organizationNameSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { organizationIdentityJobTitleSchema } from "./identity-job-title";
import { requiresSession, ok, authErrors } from "./route-contract";
import { requiredJsonBody } from "./openapi";

const address = { email: normalizedEmailSchema, emailId: databaseIdSchema.nullable() };
export const identityAffiliationPrepareSchema = z
  .object({
    phase: z.literal("prepare"),
    ...address,
    organizationName: organizationNameSchema.optional(),
    organizationResolved: z.boolean(),
    jobTitle: organizationIdentityJobTitleSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.organizationResolved && value.organizationName === undefined)
      context.addIssue({ code: "custom", path: ["organizationName"], message: "Enter your organization name." });
  });
export const identityAffiliationPreviewSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("resolve"), ...address }).strict(),
  identityAffiliationPrepareSchema,
]);
export const identityAffiliationContextSchema = z.string().min(32).max(262144);
export const identityAffiliationPreviewResponseSchema = z.object({
  email: normalizedEmailSchema,
  domain: z.string(),
  organization: z.object({ id: databaseIdSchema, name: z.string() }).nullable(),
  contextToken: identityAffiliationContextSchema.optional(),
  identityId: databaseIdSchema.optional(),
});
export const identityAffiliationPreviewRouteSchema = {
  ...requiresSession(),
  tags: ["Users"],
  summary: "Resolve a representation through an owned verified email address",
  request: { body: requiredJsonBody(identityAffiliationPreviewSchema) },
  responses: {
    ...ok("Verified representation context", identityAffiliationPreviewResponseSchema),
    ...authErrors({
      badRequest: "Invalid representation details",
      conflict: "Affiliation requires review",
      unprocessable: "Verify the representation email first",
    }),
  },
};
