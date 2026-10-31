import type { z } from "zod";
import { identitiesListResponseSchema, type ActingIdentity } from "../../shared/schemas/identity";
import type { ServerCatalog } from "./server-catalog";

/**
 * What an identity held without an organization is called, everywhere it is
 * named: the identity chooser, the account menu and the person's own record.
 */
export const PERSONAL_IDENTITY_LABEL = "Personal";

/** "Organization · Job title · address", or "Personal" for the identity without one; the address is optional. */
export function actingIdentityLabel(
  identity: Pick<ActingIdentity, "organizationName" | "jobTitle"> & Partial<Pick<ActingIdentity, "email">>,
): string {
  return [identity.organizationName ?? PERSONAL_IDENTITY_LABEL, identity.jobTitle, identity.email]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The order identities are offered in: an organization that holds a membership first, then other
 * organizations, and the personal identity last, because taking part for an organization is the norm.
 */
export function orderedForChoice<T extends { organizationId: string | null; membershipCategory?: string | null }>(
  identities: readonly T[],
): T[] {
  const rank = (identity: T) => (identity.organizationId ? (identity.membershipCategory ? 0 : 1) : 2);
  return [...identities].sort((a, b) => rank(a) - rank(b));
}

/** What a registration names as its representation: an organization still in staff review reads as such, not as Personal. */
export function registrationRepresentationLabel(
  identity: Pick<ActingIdentity, "organizationName" | "jobTitle">,
  pendingOrganizationName: string | null,
): string {
  return !identity.organizationName && pendingOrganizationName
    ? [pendingOrganizationName, identity.jobTitle, "awaiting review"].filter(Boolean).join(" · ")
    : actingIdentityLabel(identity);
}

/** The caller supplies an endpoint whose authority owns the identity collection. */
export function actingIdentityCatalog(
  endpoint: string,
  itemLabel: (identity: ActingIdentity) => string = actingIdentityLabel,
  params: Record<string, string> = { active: "true" },
): ServerCatalog<ActingIdentity, z.infer<typeof identitiesListResponseSchema>> {
  return {
    endpoint,
    responseSchema: identitiesListResponseSchema,
    resolveItems: (response) => response.identities,
    resolvePage: (response) => response.page,
    itemKey: (identity) => identity.id,
    itemLabel,
    params,
    sort: "organization_name",
  };
}
