import { personNamePatchSchema } from "./api-common";
import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { eventSlugParamsSchema, normalizedEmailSchema, jobTitleSchema } from "./api-common";
import { consentItemSchema } from "./registration";
import { memberJoinApplicantKindSchema } from "./member-join";
import { linksSchema } from "./links";
import { identitiesListQuerySchema, identitiesListResponseSchema } from "./identity";
import {
  identityProfileUpdateSchema as ownIdentityProfileUpdateSchema,
  ownIdentityProfileSchema,
} from "./own-identity-profile";
import { protectsPublicAction } from "./abuse-protection";
import { publicOperation } from "./route-contract";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { databaseIdSchema } from "./identifiers";
import { httpCapabilityUrlSchema } from "./urls";
import { proposalEntryContextSchema } from "./proposal-entry";
import { screensWorkEmailDomain, workEmailStepSchema } from "./work-email";
import { identityAffiliationPrepareBaseSchema, identityAffiliationPreviewResponseSchema } from "./identity-affiliation";

export const eventProposalContinuationTokenSchema = z.string().min(32).max(EMAIL_AUTH_TOKEN_MAX_LENGTH);

/**
 * Carries the continuation token of the mailbox proof just completed on a
 * speaker link, so that step may also change the person's own photo.
 */
export const SPEAKER_MAILBOX_PROOF_HEADER = "x-pkic-mailbox-proof";
export const speakerMailboxProofHeadersSchema = z.object({
  [SPEAKER_MAILBOX_PROOF_HEADER]: eventProposalContinuationTokenSchema.nullish(),
});

/**
 * Starts mailbox proof for a proposal contact or speaker from the shared
 * email-first step. `unaffiliatedAttestation` is the capacity: `true` takes
 * part as an individual, `false` on behalf of an organization, which only that
 * organization's own mailbox can show.
 */
export const eventProposalProofStartSchema = workEmailStepSchema
  .extend({
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerProposalId: databaseIdSchema.optional(),
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    entryContext: proposalEntryContextSchema.optional(),
    /** The terms accepted before the email step; no mailbox is emailed until they are. */
    consents: z.array(consentItemSchema).max(20),
  })
  .strict();
/**
 * `verified` answers a speaker who opened their own invitation link and gave the
 * address it was mailed to: that link already proved the mailbox, so no second
 * email is sent and the token continues exactly as the emailed one would.
 */
export const eventProposalProofStartResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("verification_sent") }),
  z.object({ status: z.literal("verified"), token: eventProposalContinuationTokenSchema }),
]);
export const eventProposalProofVerifySchema = z
  .object({
    token: eventProposalContinuationTokenSchema,
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerProposalId: databaseIdSchema.optional(),
    ...identityAffiliationPrepareBaseSchema.pick({ domain: true }).shape,
    affiliation: identityAffiliationPrepareBaseSchema.omit({ phase: true, email: true, emailId: true }).optional(),
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
export const eventProposalProofPersonPatchSchema = personNamePatchSchema.safeExtend({
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
/** A representation is on behalf of an organization, so its job title stays required. */
export const eventProposalIdentityJobTitlePatchSchema = z
  .object({
    jobTitle: jobTitleSchema,
  })
  .strict();
/**
 * A speaker's edit of an identity they hold — the same profile fields and
 * rules as every other identity edit (`ownIdentityProfileUpdateSchema`) —
 * with the authority they edit it through: their speaker link, an email
 * confirmation, or their session on one proposal. The identity itself is
 * edited, so every record made as it shows the change.
 */
export const eventProposalProofIdentityPatchSchema = ownIdentityProfileUpdateSchema
  .extend({
    continuationToken: eventProposalContinuationTokenSchema.optional(),
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerProposalId: databaseIdSchema.optional(),
  })
  .strict();
export const eventProposalProofIdentityPatchResponseSchema = ownIdentityProfileSchema.omit({
  organizationName: true,
});
export const eventProposalProofIdentityPatchRouteSchema = {
  ...publicOperation(),
  tags: ["Proposals"],
  summary: "Update the profile of an identity you speak as",
  request: {
    params: eventSlugParamsSchema.extend({ identityId: databaseIdSchema }),
    body: requiredJsonBody(eventProposalProofIdentityPatchSchema),
  },
  responses: {
    "200": jsonResponse("The identity's saved profile.", eventProposalProofIdentityPatchResponseSchema),
  },
};
export const eventProposalProofVerifyResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    continuationToken: eventProposalContinuationTokenSchema,
    applicantKind: memberJoinApplicantKindSchema,
    /** The terms this confirmation recorded; still current, or the confirmation would have been refused. */
    consents: z.array(consentItemSchema).max(20),
    person: eventProposalProofPersonSchema.nullable(),
    email: normalizedEmailSchema,
    affiliation: identityAffiliationPreviewResponseSchema.optional(),
    organization: z
      .object({
        id: databaseIdSchema,
        name: z.string(),
        /** The person's job title in the representation of this organization they already hold; null when none. */
        jobTitle: z.string().nullable(),
      })
      .nullable(),
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerProposalId: databaseIdSchema.optional(),
    speakerManageUrl: httpCapabilityUrlSchema.optional(),
    entryContext: proposalEntryContextSchema.optional(),
  }),
  z.object({ status: z.literal("support_required") }),
  /** The proved address belongs to another account: sign in with it; nothing was linked or created. */
  z.object({ status: z.literal("sign_in_required"), email: normalizedEmailSchema }),
]);
export const eventProposalProofIdentitiesSchema = z
  .object({
    continuationToken: eventProposalContinuationTokenSchema,
    speakerManagementToken: eventProposalContinuationTokenSchema.optional(),
    speakerProposalId: databaseIdSchema.optional(),
  })
  .strict();

export const eventProposalProofStartRouteSchema = {
  ...publicOperation(),
  ...protectsPublicAction("proposal_proof", "proposals:manage"),
  ...screensWorkEmailDomain(),
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
