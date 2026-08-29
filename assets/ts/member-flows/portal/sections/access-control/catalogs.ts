import type { z } from "zod";
import {
  permissionTargetsListResponseSchema,
  rolesListResponseSchema,
  type PermissionTarget,
  type Role,
} from "../../../../../shared/schemas/access-control";
import type { ServerCatalog } from "../../../../shared/server-catalog";

/** Bounded, schema-validated catalogues used by the global access-control forms. */
export const roleCatalog: ServerCatalog<Role, z.infer<typeof rolesListResponseSchema>> = {
  endpoint: "/api/v1/roles",
  responseSchema: rolesListResponseSchema,
  resolveItems: (response) => response.roles,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => item.name,
  sort: "name",
};

export function permissionTargetCatalog(
  contextType: PermissionTarget["type"],
): ServerCatalog<PermissionTarget, z.infer<typeof permissionTargetsListResponseSchema>> {
  return {
    endpoint: "/api/v1/permissions/targets",
    params: { contextType },
    responseSchema: permissionTargetsListResponseSchema,
    resolveItems: (response) => response.targets,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.id,
    itemLabel: (item) => item.name,
    sort: "name",
  };
}
