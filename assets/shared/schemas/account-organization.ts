/**
 * Account setup's organization step: a work address that signs in or starts
 * an account names its organization, or (on a domain no organization has
 * claimed) says it is a personal address, before any session exists.
 *
 * The sign-in link itself proves the mailbox, so the same verify request
 * carries the step: `affiliation` asks for the domain's organizations (and a
 * signed selection once complete), `organization` answers the step.
 */
import { z } from "zod";
import {
  identityAffiliationContextSchema,
  identityAffiliationPrepareBaseSchema,
  identityAffiliationPreviewResponseSchema,
} from "./identity-affiliation";
import { emailDomainNameSchema } from "./email-domains";

/** The person's selection, without the address the link already names. */
export const accountOrganizationSelectionSchema = identityAffiliationPrepareBaseSchema.omit({
  phase: true,
  email: true,
  emailId: true,
});

export const accountOrganizationAffiliationRequestSchema = z.union([
  z.object({ domain: emailDomainNameSchema.optional() }).strict(),
  z.object({ selection: accountOrganizationSelectionSchema }).strict(),
]);

/** The step's answer: a prepared organization, or a personal address where that is allowed. */
export const accountOrganizationAnswerSchema = z.union([
  z.object({ contextToken: identityAffiliationContextSchema }).strict(),
  z.object({ personal: z.literal(true) }).strict(),
]);
export type AccountOrganizationAnswer = z.infer<typeof accountOrganizationAnswerSchema>;

/** What the verify request answers while the step is open: no session yet. */
export const accountOrganizationRequiredSchema = z.object({
  success: z.literal(true),
  organizationRequired: z.object({
    affiliation: identityAffiliationPreviewResponseSchema,
    /** Only a domain no organization has claimed can be used as a personal address. */
    personalAllowed: z.boolean(),
  }),
});
export type AccountOrganizationRequired = z.infer<typeof accountOrganizationRequiredSchema>;
