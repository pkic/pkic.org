import { identityAffiliationPreviewResponseSchema, identityAffiliationPrepareBaseSchema } from "./identity-affiliation";
import { emailDomainNameSchema } from "./email-domains";
import { z } from "zod";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { normalizedEmailSchema, tokenSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { sourceTypeSchema } from "./source";

/**
 * The mailbox proof a registration's confirmation link is exchanged for, so
 * the confirmation page can ask which organization a work address names.
 */
export const registrationEmailProofTokenSchema = z.string().trim().min(32).max(EMAIL_AUTH_TOKEN_MAX_LENGTH);

/** How someone reached the registration form: an invitation, a referral or a campaign source. */
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

export const registrationEmailProofVerifySchema = z
  .object({
    token: registrationEmailProofTokenSchema,
    domain: emailDomainNameSchema.optional(),
    affiliation: identityAffiliationPrepareBaseSchema.omit({ email: true, emailId: true, phase: true }).optional(),
  })
  .strict();

/** The saved names of the person the confirmation link belongs to. */
export const registrationProvedPersonSchema = z.object({
  userId: databaseIdSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});

export const registrationEmailProofVerifyResponseSchema = z.object({
  email: normalizedEmailSchema,
  unaffiliatedAttestation: z.boolean(),
  person: registrationProvedPersonSchema.nullable(),
  /** Every proved work address confirms its organization through the shared chooser. */
  asksOrganization: z.boolean(),
  affiliation: identityAffiliationPreviewResponseSchema.nullable(),
});
export type RegistrationEmailProofVerifyResponse = z.infer<typeof registrationEmailProofVerifyResponseSchema>;
