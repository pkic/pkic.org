import type { z } from "zod";
import {
  SYSTEM_ROLE_IDS,
  permissionTargetsListResponseSchema,
  rolesListResponseSchema,
  type PermissionTarget,
  type Role,
} from "../../../../../shared/schemas/access-control";
import { EVENT_TEAM_ROLE_IDS } from "../../../../../shared/schemas/event-team";
import type { ServerCatalog } from "../../../../shared/server-catalog";

/**
 * Roles granted elsewhere, never from the global forms: group leadership from
 * the group's Leadership section, and event team roles from the event's Team
 * settings, so each one belongs to one group or event.
 */
const ROLES_GRANTED_ELSEWHERE: ReadonlySet<string> = new Set([
  SYSTEM_ROLE_IDS.groupLead,
  SYSTEM_ROLE_IDS.groupDeputyLead,
  ...Object.values(EVENT_TEAM_ROLE_IDS),
]);

/** An event team role: granted for one event from that event's Team settings. */
export function isEventTeamRole(roleId: string): boolean {
  return (Object.values(EVENT_TEAM_ROLE_IDS) as string[]).includes(roleId);
}

/** Bounded, schema-validated catalogs used by the global access-control forms. */
export const roleCatalog: ServerCatalog<Role, z.infer<typeof rolesListResponseSchema>> = {
  endpoint: "/api/v1/roles",
  responseSchema: rolesListResponseSchema,
  resolveItems: (response) => response.roles.filter((role) => !ROLES_GRANTED_ELSEWHERE.has(role.id)),
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
