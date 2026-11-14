/**
 * An organization's email domains, as staff manage them.
 *
 * A domain reaches an organization in one of two ways the shared resolver
 * (`organization-domain.ts`) knows: a claim (`claimed`), which a person's
 * email challenge or staff add, or people who joined through a verified
 * address on it before claims were recorded (`derived`). Staff add and remove
 * claims here; derived domains are listed so the view explains where each
 * linked person came from.
 */
import { z } from "zod";
import { successResponseSchema, trimmedString } from "./api-common";
import { emailDomainNameSchema } from "./email-domains";
import { organizationManagementParamsSchema } from "./organization-management";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, created, ok, requiresPermissions } from "./route-contract";

export const ORGANIZATION_DOMAIN_STATUSES = ["claimed", "derived"] as const;
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
 * earlier. Shared domains require people to choose an organization.
 */
export const organizationDomainClaimPreviewSchema = z.object({
  domain: z.string(),
  /** Another organization claims or has a verified affiliation on the domain, or an application holds it. */
  shared: z.boolean(),
});
export type OrganizationDomainClaimPreview = z.infer<typeof organizationDomainClaimPreviewSchema>;
export const organizationDomainClaimPreviewResponseSchema = z.object({ preview: organizationDomainClaimPreviewSchema });

export const organizationDomainClaimResponseSchema = z.object({
  domain: organizationDomainSchema,
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
    "Records an organization's claim to a domain, including domains shared with other organizations or pending applications. Each person must explicitly confirm their affiliation. Free and disposable mail domains and public suffixes cannot be claimed.",
  request: {
    params: organizationManagementParamsSchema,
    body: { required: true, content: { "application/json": { schema: organizationDomainClaimCreateSchema } } },
  },
  responses: {
    ...created("Domain claimed.", organizationDomainClaimResponseSchema),
    ...authErrors({
      badRequest: "Invalid domain or reason.",
      notFound: "Organization not found.",
      conflict: "This organization already claims the domain, the claim changed, or the organization was merged.",
      unprocessable: "Free and disposable mail domains and public suffixes cannot be claimed.",
    }),
  },
};

export const organizationDomainClaimPreviewRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:write"),
  summary: "Preview claiming an email domain for an organization",
  description:
    "Refused exactly as the claim would be. Otherwise reports whether another organization or pending application shares the domain. People must confirm their affiliation after a claim.",
  request: { params: organizationDomainParamsSchema },
  responses: {
    ...ok("What the claim would do.", organizationDomainClaimPreviewResponseSchema),
    ...authErrors({
      badRequest: "Invalid domain.",
      notFound: "Organization not found.",
      conflict: "This organization already claims the domain, the claim changed, or the organization was merged.",
      unprocessable: "Free and disposable mail domains cannot be claimed.",
    }),
  },
};

export const organizationDomainClaimDeleteRouteSchema = {
  tags: ["Organizations"],
  ...requiresPermissions("organizations:write"),
  summary: "Remove an organization's claim on an email domain",
  description:
    "People already linked keep their identities; the removed claim no longer supports new affiliation choices.",
  request: { params: organizationDomainParamsSchema },
  responses: {
    ...ok("Claim removed.", successResponseSchema),
    ...authErrors({ badRequest: "Invalid domain.", notFound: "The organization does not claim this domain." }),
  },
};
