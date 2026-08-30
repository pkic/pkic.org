/** Organization representation, verification evidence, and lifecycle contracts. */
import { z } from "zod";
import { booleanQueryFlagSchema, normalizedEmailSchema, successResponseSchema, trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema } from "./urls";

export const ORGANIZATION_REPRESENTATION_SOURCES = [
  "verified_domain",
  "organization_contact",
  "staff",
  "migration",
] as const;
export const organizationRepresentationSourceSchema = z.enum(ORGANIZATION_REPRESENTATION_SOURCES);

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
  verifiedAt: z.string().nullable(),
  verificationMethod: emailVerificationMethodSchema.nullable(),
});

export const REPRESENTATION_DOMAIN_OUTCOMES = [
  "exact_claimed_match",
  "unverified_email",
  "free_or_personal_domain",
  "disposable_domain",
  "ambiguous_domain",
  "unclaimed_domain",
  "blocked_relationship",
] as const;
export const representationDomainOutcomeSchema = z.enum(REPRESENTATION_DOMAIN_OUTCOMES);

export const representationDomainAssessmentSchema = z.object({
  email: normalizedEmailSchema,
  domain: z.string().trim().min(1).max(253),
  outcome: representationDomainOutcomeSchema,
  mayAutomaticallyAssociate: z.boolean(),
  warning: z.string().nullable(),
  memberId: databaseIdSchema.nullable(),
});
export type RepresentationDomainAssessment = z.infer<typeof representationDomainAssessmentSchema>;

export const organizationRepresentativeSchema = z.object({
  id: databaseIdSchema,
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema,
  organizationName: z.string(),
  userId: databaseIdSchema,
  userName: z.string(),
  emailId: databaseIdSchema.nullable(),
  email: z.email(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  source: organizationRepresentationSourceSchema,
  showOnOrganizationProfile: z.boolean(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
  blockedAt: z.string().nullable(),
  blockedByUserId: databaseIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrganizationRepresentative = z.infer<typeof organizationRepresentativeSchema>;

/** Associate an existing user or provision an attributable representative by email. */
export const representativeAssociateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing_user"),
    userId: databaseIdSchema,
    emailId: databaseIdSchema.nullable().optional(),
    jobTitle: trimmedString(0, 200).nullable().optional(),
    biography: trimmedString(0, 5000).nullable().optional(),
    links: linksSchema.optional(),
    showOnOrganizationProfile: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("email"),
    email: normalizedEmailSchema,
    name: trimmedString(1, 200),
    jobTitle: trimmedString(0, 200).optional(),
    biography: trimmedString(0, 5000).optional(),
    links: linksSchema.optional(),
    showOnOrganizationProfile: z.boolean().default(true),
  }),
]);
export const representativeProfileUpdateSchema = z.object({
  emailId: databaseIdSchema.nullable().optional(),
  jobTitle: trimmedString(0, 200).nullable().optional(),
  biography: trimmedString(0, 5000).nullable().optional(),
  links: linksSchema.optional(),
  showOnOrganizationProfile: z.boolean().optional(),
});
export const representativeRemoveSchema = z.object({ reason: trimmedString(1, 500).optional() }).default({});
export const representativeRestoreSchema = z.object({ reason: trimmedString(1, 500).optional() });
export const representativeMutationResponseSchema = successResponseSchema.extend({
  representativeId: databaseIdSchema,
});

export const ORGANIZATION_REPRESENTATIVE_SORT_COLUMNS = [
  "user_name",
  "email",
  "organization_name",
  "joined_at",
  "updated_at",
] as const;
export const organizationRepresentativesListQuerySchema = listQuerySchema(
  ORGANIZATION_REPRESENTATIVE_SORT_COLUMNS,
).extend({
  memberId: databaseIdSchema.optional(),
  userId: databaseIdSchema.optional(),
  active: booleanQueryFlagSchema.optional(),
  blocked: booleanQueryFlagSchema.optional(),
  source: organizationRepresentationSourceSchema.optional(),
});
export type OrganizationRepresentativesListQuery = z.infer<typeof organizationRepresentativesListQuerySchema>;
export const organizationRepresentativesListResponseSchema = paginatedResponseSchema(
  "representatives",
  organizationRepresentativeSchema,
);
