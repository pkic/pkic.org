/** Approved Member acting identities, proof evidence, and lifecycle contracts. */
import { z } from "zod";
import {
  booleanQueryFlagSchema,
  normalizedEmailSchema,
  successResponseSchema,
  trimmedString,
  utcInstantSchema,
} from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema } from "./urls";

export const IDENTITY_SOURCES = [
  "membership_approval",
  "verified_domain",
  "organization_contact",
  "staff",
  "migration",
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
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string().min(1),
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

const identityActivationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("invitation") }),
  z.object({
    mode: z.literal("immediate"),
    reason: trimmedString(1, 500, "Document why this identity is being activated immediately."),
  }),
]);

/** Invite an existing user or provision an attributable user by email. */
export const identityCreateSchema = z.discriminatedUnion("userReference", [
  z.object({
    userReference: z.literal("existing_user"),
    userId: databaseIdSchema,
    activation: identityActivationSchema.default({ mode: "invitation" }),
    ...identityProfileFields,
  }),
  z.object({
    userReference: z.literal("email"),
    email: normalizedEmailSchema,
    name: trimmedString(1, 200),
    activation: identityActivationSchema.default({ mode: "invitation" }),
    jobTitle: trimmedString(0, 200).optional(),
    biography: trimmedString(0, 5000).optional(),
    links: linksSchema.optional(),
    showOnOrganizationProfile: z.boolean().default(true),
  }),
]);

/** The current user explicitly activates one exact claimed-domain identity. */
export const currentUserIdentityCreateSchema = z.object({
  emailId: databaseIdSchema.nullable(),
  organizationId: databaseIdSchema,
});

/** The signed-in user accepts one pending identity invitation addressed to them. */
export const currentUserIdentityAcceptSchema = z.object({
  transition: z.object({ state: z.literal("active") }),
});

export const identityProfileUpdateSchema = z
  .object(identityProfileFields)
  .refine((value) => Object.keys(value).length > 0, "At least one identity profile field is required");

export const identityTransitionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active"), reason: trimmedString(1, 500) }),
  z.object({ state: z.literal("ended"), reason: trimmedString(1, 500) }),
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

export const identityMutationResponseSchema = successResponseSchema.extend({
  identityId: databaseIdSchema,
  state: identityStateSchema,
});

export const IDENTITY_SORT_COLUMNS = ["user_name", "email", "organization_name", "started_at", "updated_at"] as const;
export const identitiesListQuerySchema = listQuerySchema(IDENTITY_SORT_COLUMNS).extend({
  memberId: databaseIdSchema.optional(),
  organizationId: databaseIdSchema.optional(),
  userId: databaseIdSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  blocked: booleanQueryFlagSchema.optional(),
  source: identitySourceSchema.optional(),
});
export type IdentitiesListQuery = z.infer<typeof identitiesListQuerySchema>;
export const identitiesListResponseSchema = paginatedResponseSchema("identities", actingIdentitySchema);
