/** Organization representation, verification evidence, and lifecycle contracts. */
import { z } from "zod";
import { booleanQueryFlagSchema, normalizedEmailSchema, trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

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

export const organizationRepresentativeSchema = z.object({
  id: databaseIdSchema,
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema,
  organizationName: z.string(),
  userId: databaseIdSchema,
  userName: z.string(),
  email: z.email(),
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

export const representativeAssociateSchema = z.object({
  userId: databaseIdSchema,
  showOnOrganizationProfile: z.boolean().default(true),
});
export const representativeProfileUpdateSchema = z.object({ showOnOrganizationProfile: z.boolean() });
export const representativeRemoveSchema = z.object({ reason: trimmedString(1, 500).optional() });
export const representativeRestoreSchema = z.object({ reason: trimmedString(1, 500).optional() });

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
export const organizationRepresentativesListResponseSchema = paginatedResponseSchema(
  "representatives",
  organizationRepresentativeSchema,
);

export const representativeParamsSchema = z.object({
  memberId: databaseIdSchema,
  userId: databaseIdSchema,
});
export const representativeResponseSchema = z.object({ representative: organizationRepresentativeSchema });
