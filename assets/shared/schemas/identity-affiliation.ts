import { z } from "zod";
import { normalizedEmailSchema, organizationNameSchema, ORGANIZATION_NAME_REQUIRED } from "./api-common";
import { emailDomainNameSchema } from "./email-domains";
import { databaseIdSchema } from "./identifiers";
import { organizationIdentityJobTitleSchema } from "./identity-job-title";
import { requiresSession, ok, authErrors } from "./route-contract";
import { requiredJsonBody } from "./openapi";

const address = {
  email: normalizedEmailSchema,
  emailId: databaseIdSchema.nullable(),
  /** Selected suffix of the verified work address; defaults to the server suggestion. */
  domain: emailDomainNameSchema.optional(),
};
export const identityAffiliationPrepareBaseSchema = z
  .object({
    phase: z.literal("prepare"),
    ...address,
    organizationName: organizationNameSchema.optional(),
    organizationId: databaseIdSchema.nullable(),
    jobTitle: organizationIdentityJobTitleSchema,
  })
  .strict();
export const identityAffiliationPrepareSchema = identityAffiliationPrepareBaseSchema.superRefine((value, context) => {
  if (value.organizationId === null && value.organizationName === undefined)
    context.addIssue({ code: "custom", path: ["organizationName"], message: ORGANIZATION_NAME_REQUIRED });
});
export const identityAffiliationPreviewSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("resolve"), ...address, unaffiliatedAttestation: z.boolean().default(false) }).strict(),
  identityAffiliationPrepareSchema,
]);
export const identityAffiliationContextSchema = z.string().min(32).max(262144);
export const identityAffiliationPreviewResponseSchema = z.object({
  email: normalizedEmailSchema,
  domain: z.string(),
  domains: z
    .array(z.object({ domain: emailDomainNameSchema, canLink: z.boolean(), organizationName: z.string().nullable() }))
    .max(128),
  organization: z.object({ id: databaseIdSchema, name: z.string() }).nullable(),
  organizations: z
    .array(
      z.object({
        id: databaseIdSchema,
        name: z.string(),
        identityId: databaseIdSchema.nullable(),
        jobTitle: organizationIdentityJobTitleSchema.nullable(),
      }),
    )
    .max(256),
  /** The selected work domain is reserved by a pending membership application. */
  reviewRequired: z.boolean().optional(),
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
