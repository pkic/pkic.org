import { identityAffiliationPreviewResponseSchema, identityAffiliationPrepareBaseSchema } from "./identity-affiliation";
import { emailDomainNameSchema } from "./email-domains";
import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { normalizedEmailSchema, tokenSchema, personNamePatchSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { sourceTypeSchema } from "./source";
import { workEmailStepSchema } from "./work-email";

/** The signed link a registrant opens to prove their mailbox; the registration carries it when submitted. */
export const registrationEmailProofTokenSchema = z.string().trim().min(32).max(EMAIL_AUTH_TOKEN_MAX_LENGTH);

/**
 * How someone reached the registration form — an invitation, a referral or a
 * campaign source. The verification link carries it back, so the form the
 * link opens is the one the person started.
 */
export const registrationEntrySchema = z
  .object({
    inviteToken: tokenSchema.optional(),
    inviteId: databaseIdSchema.optional(),
    referralCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{6,12}$/)
      .optional(),
    sourceType: sourceTypeSchema.optional(),
  })
  .strict();
export type RegistrationEntry = z.infer<typeof registrationEntrySchema>;

/** Registration starts from the shared email-first step: the address is verified before anything else is asked. */
export const registrationEmailProofStartSchema = workEmailStepSchema
  .extend({ entry: registrationEntrySchema.optional() })
  .strict();
export const registrationEmailProofStartResponseSchema = z.object({ status: z.literal("verification_sent") });

export const registrationEmailProofVerifySchema = z
  .object({
    token: registrationEmailProofTokenSchema,
    domain: emailDomainNameSchema.optional(),
    affiliation: identityAffiliationPrepareBaseSchema.omit({ email: true, emailId: true, phase: true }).optional(),
  })
  .strict();

/**
 * What a verified address continues with. Only the mailbox holder reaches
 * this, so the saved names of a person already known by the address, and
 * whether its domain names an organization, are theirs to see.
 */
export const registrationProvedPersonSchema = z.object({
  userId: databaseIdSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});
export const registrationProofPersonPatchSchema = personNamePatchSchema.safeExtend({
  token: registrationEmailProofTokenSchema,
  userId: databaseIdSchema,
});
export const registrationProofPersonPatchResponseSchema = z.object({ person: registrationProvedPersonSchema });

export const registrationEmailProofVerifyResponseSchema = z.object({
  email: normalizedEmailSchema,
  unaffiliatedAttestation: z.boolean(),
  person: registrationProvedPersonSchema.nullable(),
  /** Every proved work address confirms its organization through the shared chooser. */
  asksOrganization: z.boolean(),
  affiliation: identityAffiliationPreviewResponseSchema.nullable(),
});
export type RegistrationEmailProofVerifyResponse = z.infer<typeof registrationEmailProofVerifyResponseSchema>;
