import type { z } from "zod";
import {
  accessControlContextsListResponseSchema,
  rolesListResponseSchema,
  type AccessControlContext,
  type Role,
} from "../../../../../shared/schemas/access-control";
import type { ServerCatalog } from "../../../../shared/server-catalog";

/** Bounded, schema-validated catalogues used by the global access-control forms. */
export const systemRoleCatalog: ServerCatalog<Role, z.infer<typeof rolesListResponseSchema>> = {
  endpoint: "/api/v1/system/access-control/roles",
  responseSchema: rolesListResponseSchema,
  resolveItems: (response) => response.roles,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => item.name,
  sort: "name",
};

export function systemContextCatalog(
  contextType: AccessControlContext["type"],
): ServerCatalog<AccessControlContext, z.infer<typeof accessControlContextsListResponseSchema>> {
  return {
    endpoint: "/api/v1/system/access-control/contexts",
    params: { contextType },
    responseSchema: accessControlContextsListResponseSchema,
    resolveItems: (response) => response.contexts,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.id,
    itemLabel: (item) => item.name,
    sort: "name",
  };
}
