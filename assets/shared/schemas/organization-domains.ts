/**
 * An organization's email domains, as staff manage them.
 *
 * A domain reaches an organization in one of three ways the shared resolver
 * (`organization-domain.ts`) already knows: an approved claim (`claimed`),
 * people who joined through a verified address on it without a claim
 * (`derived`), or a pending membership application that holds it (`held`).
 * Staff add and remove claims here; derived and held domains are listed so
 * the view explains where each linked person came from.
 */
import { z } from "zod";
import { successResponseSchema, trimmedString } from "./api-common";
import { emailDomainNameSchema } from "./email-domains";
import { databaseIdSchema } from "./identifiers";
import { organizationManagementParamsSchema } from "./organization-management";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, created, ok, requiresPermissions } from "./route-contract";

export const ORGANIZATION_DOMAIN_STATUSES = ["claimed", "derived", "held"] as const;
export type OrganizationDomainStatus = (typeof ORGANIZATION_DOMAIN_STATUSES)[number];

export const organizationDomainParamsSchema = organizationManagementParamsSchema.extend({
  domain: emailDomainNameSchema,
});

/**
 * A claim normally names the organization's registrable domain (`ibm.com`),
 * which every address on its subdomains follows; a subdomain may be claimed
 * explicitly, and then the most specific claim wins for addresses below it.
 * The Worker refuses free, disposable and public-suffix domains against its
 * vendored lists, which the browser does not carry.
 */
export const organizationDomainClaimCreateSchema = z.object({
  domain: emailDomainNameSchema,
  /** Why staff recognize the domain as the organization's; kept in the audit log. */
  reason: trimmedString(3, 500, "Say why this domain is the organization's."),
});
export type OrganizationDomainClaimCreate = z.infer<typeof organizationDomainClaimCreateSchema>;

/** The add form's request as one value: the organization from the path, the claim from the body. */
export const organizationDomainClaimRequestSchema = z.intersection(
  organizationManagementParamsSchema,
  organizationDomainClaimCreateSchema,
);

export const organizationDomainSchema = z.object({
  domain: z.string(),
  status: z.enum(ORGANIZATION_DOMAIN_STATUSES),
  /** Distinct people whose active identity here follows an address on the domain. */
  people: z.number().int().nonnegative(),
  /** When the claim was approved; null for derived and held domains. */
  claimedAt: z.string().nullable(),
});
export type OrganizationDomain = z.infer<typeof organizationDomainSchema>;

export const ORGANIZATION_DOMAIN_SORT_COLUMNS = ["domain", "people"] as const;
export const organizationDomainsListQuerySchema = listQuerySchema(ORGANIZATION_DOMAIN_SORT_COLUMNS);
export type OrganizationDomainsListQuery = z.infer<typeof organizationDomainsListQuerySchema>;
export const organizationDomainsListResponseSchema = paginatedResponseSchema("domains", organizationDomainSchema);

/**
 * What a claim does to the people who verified an address on the domain
 * earlier: both member and non-member organizations affiliate them automatically.
 */
export const organizationDomainClaimPreviewSchema = z.object({
  domain: z.string(),
  /** People with a verified address on the domain and no relationship with the organization yet. */
  peopleToLink: z.number().int().nonnegative(),
});
export type OrganizationDomainClaimPreview = z.infer<typeof organizationDomainClaimPreviewSchema>;
export const organizationDomainClaimPreviewResponseSchema = z.object({ preview: organizationDomainClaimPreviewSchema });

export const organizationDomainLinkingSchema = z.object({
  /** People joined while the claim was saved. */
  peopleLinked: z.number().int().nonnegative(),
  /** More people remain; the scheduler links them in bounded passes. */
  continuing: z.boolean(),
});
export type OrganizationDomainLinking = z.infer<typeof organizationDomainLinkingSchema>;

export const organizationDomainClaimResponseSchema = z.object({
  domain: organizationDomainSchema,
  linking: organizationDomainLinkingSchema,
});

/** The organization that already claims a domain, so staff can merge instead. */
export const organizationDomainClaimedElsewhereDetailsSchema = z.object({
  organizationId: databaseIdSchema,
  organizationName: z.string(),
});

export const organizationDomainsListRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:read"),
  summary: "List an organization's email domains",
  description:
    "Claimed domains, domains people joined through without a claim, and domains a pending application holds, each with the number of people linked through it.",
  request: { params: organizationManagementParamsSchema, query: organizationDomainsListQuerySchema },
  responses: {
    ...ok("The organization's domains.", organizationDomainsListResponseSchema),
    ...authErrors({ badRequest: "Invalid list query.", notFound: "Organization not found." }),
  },
};

export const organizationDomainClaimCreateRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:write"),
  summary: "Claim an email domain for an organization",
  description:
    "Records that verified addresses on the domain and its subdomains belong to this organization and links everyone who already verified one, through the same rule as a fresh verification (in bounded scheduled passes for a large domain). Refused for free or disposable mail and public suffixes, for a domain another organization claims (merge the organizations instead; the refusal names it), and for a domain a pending application holds.",
  request: {
    params: organizationManagementParamsSchema,
    body: { required: true, content: { "application/json": { schema: organizationDomainClaimCreateSchema } } },
  },
  responses: {
    ...created("Domain claimed.", organizationDomainClaimResponseSchema),
    ...authErrors({
      badRequest: "Invalid domain or reason.",
      notFound: "Organization not found.",
      conflict: "The domain is already claimed or held, or the organization was merged.",
      unprocessable: "Free and disposable mail domains and public suffixes cannot be claimed.",
    }),
  },
};

export const organizationDomainClaimPreviewRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:write"),
  summary: "Preview claiming an email domain for an organization",
  description:
    "Refused exactly as the claim would be. Otherwise says how many people with a verified address on the domain the claim would link, and whether they join or are offered the organization.",
  request: { params: organizationDomainParamsSchema },
  responses: {
    ...ok("What the claim would do.", organizationDomainClaimPreviewResponseSchema),
    ...authErrors({
      badRequest: "Invalid domain.",
      notFound: "Organization not found.",
      conflict: "The domain is already claimed or held, or the organization was merged.",
      unprocessable: "Free and disposable mail domains cannot be claimed.",
    }),
  },
};

export const organizationDomainClaimDeleteRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:write"),
  summary: "Remove an organization's claim on an email domain",
  description:
    "People already linked keep their identities; new verified addresses on the domain no longer join the organization through the claim.",
  request: { params: organizationDomainParamsSchema },
  responses: {
    ...ok("Claim removed.", successResponseSchema),
    ...authErrors({ badRequest: "Invalid domain.", notFound: "The organization does not claim this domain." }),
  },
};
