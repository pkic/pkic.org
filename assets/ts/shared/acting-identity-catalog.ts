import type { z } from "zod";
import { identitiesListResponseSchema, type ActingIdentity } from "../../shared/schemas/identity";
import type { ServerCatalog } from "./server-catalog";

/** "Organization · Job title · address", or "Individual" for the individual capacity; the address is optional. */
export function actingIdentityLabel(
  identity: Pick<ActingIdentity, "organizationName" | "jobTitle"> & Partial<Pick<ActingIdentity, "email">>,
): string {
  return [identity.organizationName ?? "Individual", identity.jobTitle, identity.email].filter(Boolean).join(" · ");
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
