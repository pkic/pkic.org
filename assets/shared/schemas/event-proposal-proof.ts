import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { eventSlugParamsSchema, normalizedEmailSchema, firstNameSchema, lastNameSchema } from "./api-common";
import { consentItemSchema } from "./registration";
import { memberJoinApplicantKindSchema } from "./member-join";
import { linksSchema } from "./links";
import { identitiesListQuerySchema, identitiesListResponseSchema, identityProfileUpdateSchema } from "./identity";
import { protectsPublicAction } from "./abuse-protection";
import { publicOperation } from "./route-contract";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { databaseIdSchema } from "./identifiers";
import { httpCapabilityUrlSchema } from "./urls";
import { proposalEntryContextSchema } from "./proposal-entry";

export const eventProposalContinuationTokenSchema = z.string().min(32).max(EMAIL_AUTH_TOKEN_MAX_LENGTH);
export const eventProposalProofStartSchema = z
  .object({
    email: normalizedEmailSchema,
    unaffiliatedAttestation: z.boolean().default(false),
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    entryContext: proposalEntryContextSchema.optional(),
    consents: z.array(consentItemSchema).max(20),
  })
  .strict();
export const eventProposalProofStartResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("verification_sent") }),
  z.object({ status: z.literal("unaffiliated_attestation_required") }),
]);
export const eventProposalProofVerifySchema = z
  .object({
    token: eventProposalContinuationTokenSchema,
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
  })
  .strict();
export const eventProposalProofPersonSchema = z.object({
  email: normalizedEmailSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  bio: z.string().nullable(),
  links: linksSchema,
});
export const eventProposalPersonNamePatchSchema = z
  .object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
  })
  .strict()
  .refine((body) => body.firstName !== undefined || body.lastName !== undefined, {
    message: "Enter a first or last name.",
  });
export const eventProposalProofPersonPatchSchema = eventProposalPersonNamePatchSchema.safeExtend({
  continuationToken: eventProposalContinuationTokenSchema.optional(),
});
export const eventProposalProofPersonPatchResponseSchema = z.object({ person: eventProposalProofPersonSchema });
export const eventProposalProofPersonPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Update the confirmed submitter's own name",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(eventProposalProofPersonPatchSchema) },
  responses: { "200": jsonResponse("Saved canonical personal details.", eventProposalProofPersonPatchResponseSchema) },
};
export const eventProposalIdentityJobTitlePatchSchema = z
  .object({
    jobTitle: identityProfileUpdateSchema.shape.jobTitle.unwrap(),
  })
  .strict();
export const eventProposalProofIdentityPatchSchema = eventProposalIdentityJobTitlePatchSchema.extend({
  continuationToken: eventProposalContinuationTokenSchema.optional(),
  speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
});
export const eventProposalProofIdentityPatchResponseSchema = z.object({
  identityId: databaseIdSchema,
  jobTitle: identityProfileUpdateSchema.shape.jobTitle.unwrap(),
});
export const eventProposalProofIdentityPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Update your active representation's role",
  request: {
    params: eventSlugParamsSchema.extend({ identityId: databaseIdSchema }),
    body: requiredJsonBody(eventProposalProofIdentityPatchSchema),
  },
  responses: {
    "200": jsonResponse("Saved canonical representation role.", eventProposalProofIdentityPatchResponseSchema),
  },
};
export const eventProposalProofVerifyResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    continuationToken: eventProposalContinuationTokenSchema,
    applicantKind: memberJoinApplicantKindSchema,
    person: eventProposalProofPersonSchema.nullable(),
    email: normalizedEmailSchema,
    organization: z.object({ id: databaseIdSchema, name: z.string() }).nullable(),
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerManageUrl: httpCapabilityUrlSchema.optional(),
    entryContext: proposalEntryContextSchema.optional(),
  }),
  z.object({ status: z.literal("support_required") }),
]);
export const eventProposalProofIdentitiesSchema = z
  .object({
    continuationToken: eventProposalContinuationTokenSchema,
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
  })
  .strict();

export const eventProposalProofStartRouteSchema = {
  ...publicOperation(),
  ...protectsPublicAction("proposal_proof", "proposals:manage"),
  tags: ["Proposals"],
  summary: "Confirm a proposal submitter's mailbox",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(eventProposalProofStartSchema) },
  responses: { "200": jsonResponse("Mailbox confirmation next step.", eventProposalProofStartResponseSchema) },
};
export const eventProposalProofVerifyRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Continue a proposal after mailbox confirmation",
  request: { params: eventSlugParamsSchema, body: requiredJsonBody(eventProposalProofVerifySchema) },
  responses: { "200": jsonResponse("Confirmed submitter context.", eventProposalProofVerifyResponseSchema) },
};
export const eventProposalProofIdentitiesRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "List the confirmed proposal submitter's own affiliations",
  request: {
    params: eventSlugParamsSchema,
    query: identitiesListQuerySchema,
    body: requiredJsonBody(eventProposalProofIdentitiesSchema),
  },
  responses: { "200": jsonResponse("Confirmed submitter affiliations.", identitiesListResponseSchema) },
};
