/** Canonical acting affiliations, proof evidence, and lifecycle contracts. */
import { z } from "zod";
import { organizationIdentityJobTitleSchema } from "./identity-job-title";
import {
  booleanQueryFlagSchema,
  normalizedEmailSchema,
  successResponseSchema,
  trimmedString,
  utcInstantSchema,
} from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { EMAIL_AUTH_TOKEN_MAX_LENGTH } from "../constants/email-auth";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema } from "./urls";
import { identityAffiliationContextSchema } from "./identity-affiliation";

export const IDENTITY_SOURCES = [
  "membership_approval",
  "verified_domain",
  "verified_email",
  "organization_contact",
  "staff",
  "migration",
  // The individual identity every new account starts with.
  "account",
] as const;
export const identitySourceSchema = z.enum(IDENTITY_SOURCES);

export const IDENTITY_STATES = ["pending", "active", "ended", "blocked"] as const;
export const identityStateSchema = z.enum(IDENTITY_STATES);

export const EMAIL_VERIFICATION_METHODS = [
  "magic_link",
  "registration_confirmation",
  "email_change_confirmation",
  "staff_verified",
  "migration_evidence",
] as const;
export const emailVerificationMethodSchema = z.enum(EMAIL_VERIFICATION_METHODS);

export const verifiedEmailIdentitySchema = z.object({
  id: databaseIdSchema.nullable(),
  email: normalizedEmailSchema,
  primary: z.boolean(),
  verifiedAt: utcInstantSchema.nullable(),
  verificationMethod: emailVerificationMethodSchema.nullable(),
  /** The identity a work address belongs to; null for the primary address and unowned ones. */
  identityId: databaseIdSchema.nullable(),
});

export const IDENTITY_DOMAIN_OUTCOMES = [
  "exact_claimed_match",
  "unverified_email",
  "free_or_personal_domain",
  "disposable_domain",
  "ambiguous_domain",
  "unclaimed_domain",
  "blocked_relationship",
] as const;
export const identityDomainOutcomeSchema = z.enum(IDENTITY_DOMAIN_OUTCOMES);

export const identityDomainAssessmentSchema = z.object({
  email: normalizedEmailSchema,
  domain: z.string().trim().min(1).max(253),
  outcome: identityDomainOutcomeSchema,
  mayCreateIdentity: z.boolean(),
  warning: z.string().nullable(),
  organizationId: databaseIdSchema.nullable(),
});
export type IdentityDomainAssessment = z.infer<typeof identityDomainAssessmentSchema>;

export const actingIdentitySchema = z.object({
  id: databaseIdSchema,
  memberId: databaseIdSchema.nullable(),
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string().min(1).nullable(),
  userId: databaseIdSchema,
  userName: z.string(),
  emailId: databaseIdSchema.nullable(),
  email: z.email(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  source: identitySourceSchema,
  state: identityStateSchema,
  showOnOrganizationProfile: z.boolean(),
  invitedAt: utcInstantSchema,
  startedAt: utcInstantSchema.nullable(),
  endedAt: utcInstantSchema.nullable(),
  blockedAt: utcInstantSchema.nullable(),
  blockedByUserId: databaseIdSchema.nullable(),
  predecessorIdentityId: databaseIdSchema.nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
});
export type ActingIdentity = z.infer<typeof actingIdentitySchema>;

const identityProfileFields = {
  emailId: databaseIdSchema.nullable().optional(),
  jobTitle: trimmedString(0, 200).nullable().optional(),
  biography: trimmedString(0, 5000).nullable().optional(),
  links: linksSchema.optional(),
  showOnOrganizationProfile: z.boolean().optional(),
};

export const immediateIdentityActivationSchema = z.object({
  mode: z.literal("immediate"),
  reason: trimmedString(1, 500, "Document why this identity is being activated immediately."),
});

const identityActivationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("invitation") }),
  immediateIdentityActivationSchema,
]);

/** Invite an existing user or provision an attributable user by email. */
export const identityCreateSchema = z.discriminatedUnion("userReference", [
  z.object({
    userReference: z.literal("existing_user"),
    userId: databaseIdSchema,
    activation: identityActivationSchema.default({ mode: "invitation" }),
    ...identityProfileFields,
    jobTitle: organizationIdentityJobTitleSchema,
  }),
  z.object({
    userReference: z.literal("email"),
    email: normalizedEmailSchema,
    name: trimmedString(1, 200),
    activation: identityActivationSchema.default({ mode: "invitation" }),
    jobTitle: organizationIdentityJobTitleSchema,
    biography: trimmedString(0, 5000).optional(),
    links: linksSchema.optional(),
    showOnOrganizationProfile: z.boolean().default(true),
  }),
]);

/** The current user explicitly activates one exact claimed-domain identity. */
export const currentUserIdentityCreateSchema = z.union([
  z
    .object({
      emailId: databaseIdSchema.nullable(),
      organizationId: databaseIdSchema,
      jobTitle: organizationIdentityJobTitleSchema,
    })
    .strict(),
  z.object({ contextToken: identityAffiliationContextSchema }).strict(),
]);

/**
 * When a representation ended: an instant no later than now. The portal
 * offers a calendar date and turns it into the end of that day in the
 * viewer's zone at the presentation boundary; "today" sends no instant and
 * the server records the moment it saves. Omitted means now.
 */
export const identityEndedAtSchema = z.iso
  .datetime({ precision: 3, error: "Choose the date the representation ended" })
  .refine((value) => Date.parse(value) <= Date.now(), "The end date can't be in the future");

/**
 * The signed-in user changes one of their own identities: accepts a pending
 * invitation addressed to them, or ends an identity they hold. Ending needs
 * no reason; it is their own representation.
 */
export const currentUserIdentityUpdateSchema = z.object({
  transition: z.discriminatedUnion("state", [
    z.object({ state: z.literal("active") }),
    z.object({ state: z.literal("ended"), endedAt: identityEndedAtSchema.optional() }),
  ]),
});

/** Bearer proof sent to the invited user's verified primary email. */
export const identityInvitationLinkRequestSchema = z.object({
  token: z.string().min(1).max(EMAIL_AUTH_TOKEN_MAX_LENGTH),
});

export const identityInvitationPreviewResponseSchema = successResponseSchema.extend({
  organizationName: z.string().min(1),
  recipientEmail: normalizedEmailSchema,
});

/**
 * Reinstating an ended identity: the owner asks for a link to the identity's
 * own address and confirms it, signed in, with the emailed token.
 */
export const identityReinstatementRequestResponseSchema = successResponseSchema.extend({
  /** Where the link was sent: the identity's own address. */
  recipientEmail: normalizedEmailSchema,
});

/** Bearer proof sent to the identity's own address. */
export const identityReinstatementLinkRequestSchema = identityInvitationLinkRequestSchema;

export const identityReinstatementPreviewResponseSchema = identityInvitationPreviewResponseSchema.extend({
  identityId: databaseIdSchema,
});

export const identityProfileUpdateSchema = z
  .object(identityProfileFields)
  .refine((value) => Object.keys(value).length > 0, "At least one identity profile field is required");

/**
 * One lifecycle transition by an organization's authorized representative.
 * `active` activates a pending identity, reinstates an ended one (the same
 * identity, its end removed), or, for staff, starts a successor to a blocked one.
 */
export const identityTransitionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active"), reason: trimmedString(1, 500) }),
  z.object({ state: z.literal("ended"), reason: trimmedString(1, 500), endedAt: identityEndedAtSchema.optional() }),
  z.object({ state: z.literal("blocked"), reason: trimmedString(1, 500) }),
]);
export type IdentityTransition = z.infer<typeof identityTransitionSchema>;

export const identityUpdateSchema = z
  .object({
    profile: identityProfileUpdateSchema.optional(),
    transition: identityTransitionSchema.optional(),
  })
  .refine((value) => (value.profile === undefined) !== (value.transition === undefined), {
    message: "Provide exactly one profile update or lifecycle transition",
  });

/** An incorrect association is replaced, not retained as a former role. */
export const identityCorrectionSchema = z
  .object({
    replacementIdentityId: databaseIdSchema,
    reason: trimmedString(3, 500, "Explain what was incorrect."),
  })
  .strict();

export const identityMutationResponseSchema = successResponseSchema.extend({
  identityId: databaseIdSchema,
  state: identityStateSchema,
});

export const IDENTITY_SORT_COLUMNS = ["user_name", "email", "organization_name", "started_at", "updated_at"] as const;
export const identitiesListQuerySchema = listQuerySchema(IDENTITY_SORT_COLUMNS).extend({
  state: identityStateSchema.optional(),
  memberId: databaseIdSchema.optional(),
  organizationId: databaseIdSchema.optional(),
  organizationOnly: booleanQueryFlagSchema.optional(),
  identityId: databaseIdSchema.optional(),
  excludeIdentityId: databaseIdSchema.optional(),
  excludeOrganizationId: databaseIdSchema.optional(),
  userId: databaseIdSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  blocked: booleanQueryFlagSchema.optional(),
  source: identitySourceSchema.optional(),
  /** Identities whose address is under this mail domain: the organization an email-first entry connects to. */
  emailDomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Must be a mail domain")
    .optional(),
});
export type IdentitiesListQuery = z.infer<typeof identitiesListQuerySchema>;
export const identitiesListResponseSchema = paginatedResponseSchema("identities", actingIdentitySchema);
