import {
  getResourceGrantDefinition,
  isManagerResourceCapability,
  isParticipantResourceCapability,
  memberResourceGrantCapabilitiesFor,
  resourceGrantCapabilitiesFor,
  visibleResourceGrantCapabilitiesForContext,
  type ResourceGrantCapability,
  type ResourceGrantKind,
} from "./definitions";
import type { GroupResourceContextAccess } from "./access";
import type { AuthorizationEvidence } from "../../db/authorization-guard";

export interface AccessibleGroupResourceIdsCte {
  sql: string;
  bindings: readonly unknown[];
}

export interface LiveGroupResourceContextAccess {
  memberEvidence: AuthorizationEvidence;
  managerEvidence: AuthorizationEvidence;
}

/** Live access evidence for reads that must authorize and fetch data in one D1 statement. */
export function buildLiveAccessibleGroupResourceIdsCte<K extends ResourceGrantKind>(
  kind: K,
  groupId: string,
  access: LiveGroupResourceContextAccess,
  capability: ResourceGrantCapability<K>,
): AccessibleGroupResourceIdsCte {
  const definition = getResourceGrantDefinition(kind);
  const memberGrants = memberResourceGrantCapabilitiesFor(definition, capability);
  const managerGrants = resourceGrantCapabilitiesFor(definition, capability).filter((candidate) =>
    isManagerResourceCapability(definition, candidate),
  );
  const ownerAllowed = isParticipantResourceCapability(definition, capability)
    ? "group_access.member_access = 1"
    : isManagerResourceCapability(definition, capability)
      ? "group_access.manager_access = 1"
      : "(group_access.member_access = 1 OR group_access.manager_access = 1)";
  const grantAccess: string[] = [];
  const grantBindings: unknown[] = [];
  if (memberGrants.length > 0) {
    grantAccess.push(
      `(group_access.member_access = 1 AND shared.capability IN (${memberGrants.map(() => "?").join(", ")}))`,
    );
    grantBindings.push(...memberGrants);
  }
  if (managerGrants.length > 0) {
    grantAccess.push(
      `(group_access.manager_access = 1 AND shared.capability IN (${managerGrants.map(() => "?").join(", ")}))`,
    );
    grantBindings.push(...managerGrants);
  }
  return {
    sql: `group_access(member_access, manager_access) AS (
      SELECT CASE WHEN EXISTS (${access.memberEvidence.sql}) THEN 1 ELSE 0 END,
             CASE WHEN EXISTS (${access.managerEvidence.sql}) THEN 1 ELSE 0 END
    ),
    accessible_resource(resource_id) AS (
      SELECT owned.id
        FROM ${definition.resourceTable} owned INDEXED BY ${definition.ownerGroupIndex}
        CROSS JOIN group_access
       WHERE owned.${definition.ownerGroupColumn} = ? AND ${ownerAllowed}
      ${
        grantAccess.length > 0
          ? `UNION
      SELECT shared.${definition.grantResourceColumn}
        FROM ${definition.grantTable} shared INDEXED BY ${definition.grantGroupIndex}
        CROSS JOIN group_access
       WHERE shared.group_id = ?
         AND (${grantAccess.join(" OR ")})`
          : ""
      }
    )`,
    bindings: [
      ...access.memberEvidence.bindings,
      ...access.managerEvidence.bindings,
      groupId,
      ...(grantAccess.length > 0 ? [groupId, ...grantBindings] : []),
    ],
  };
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
