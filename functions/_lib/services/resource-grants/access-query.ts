import {
  getResourceGrantDefinition,
  isManagerResourceCapability,
  isParticipantResourceCapability,
  visibleResourceGrantCapabilitiesForContext,
  type ResourceGrantCapability,
  type ResourceGrantKind,
} from "./definitions";
import type { GroupResourceContextAccess } from "./access";

export interface AccessibleGroupResourceIdsCte {
  sql: string;
  bindings: readonly unknown[];
}

/** Indexed D1 access boundary shared by every group-owned or group-shared resource list. */
export function buildAccessibleGroupResourceIdsCte<K extends ResourceGrantKind>(
  kind: K,
  groupId: string,
  access: GroupResourceContextAccess,
  capability: ResourceGrantCapability<K>,
): AccessibleGroupResourceIdsCte {
  const definition = getResourceGrantDefinition(kind);
  const ownerAllowed = isParticipantResourceCapability(definition, capability)
    ? access.member
    : isManagerResourceCapability(definition, capability)
      ? access.manager
      : access.member || access.manager;
  const visibleGrants = visibleResourceGrantCapabilitiesForContext(definition, capability, access);
  return {
    sql: `accessible_resource(resource_id) AS (
      SELECT owned.id
        FROM ${definition.resourceTable} owned INDEXED BY ${definition.ownerGroupIndex}
       WHERE owned.${definition.ownerGroupColumn} = ? AND ? = 1
      ${
        visibleGrants.length > 0
          ? `UNION
      SELECT shared.${definition.grantResourceColumn}
        FROM ${definition.grantTable} shared INDEXED BY ${definition.grantGroupIndex}
       WHERE shared.group_id = ?
         AND shared.capability IN (${visibleGrants.map(() => "?").join(", ")})`
          : ""
      }
    )`,
    bindings: [groupId, ownerAllowed ? 1 : 0, ...(visibleGrants.length > 0 ? [groupId, ...visibleGrants] : [])],
  };
}
