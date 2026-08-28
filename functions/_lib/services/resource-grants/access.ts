import { hasPermission } from "../../auth/permissions";
import {
  isAuthorizationGuardFailure,
  prepareAuthorizationGuard,
  type AuthorizationEvidence,
} from "../../db/authorization-guard";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { activeGroupMembershipAuthorizationEvidence, hasActiveGroupMembership } from "../groups/access";
import {
  canManageAnyGroup,
  groupManagementAuthorizationEvidence,
  prepareGroupManagementAuthorizationGuard,
} from "../groups/governance";
import type { LiveGroupResourceContextAccess } from "./access-query";
import {
  getResourceGrantDefinition,
  isManagerResourceCapability,
  isParticipantResourceCapability,
  memberResourceGrantCapabilitiesFor,
  resourceGrantCapabilitiesFor,
  type ResourceGrantCapability,
  type ResourceGrantKind,
} from "./definitions";

interface GroupIdRow {
  group_id: string;
}

export interface GroupResourceViewer {
  userId: string;
  admin?: AuthAdmin;
}

export interface GroupResourceContextAccess {
  member: boolean;
  manager: boolean;
}

/**
 * Reusable live context evidence for resource reads. Keep membership and
 * leadership inside the same D1 statement as the protected resource query so
 * a revoked grant, membership, or role cannot expose a stale page.
 */
export function liveGroupResourceContextAccess(
  viewer: GroupResourceViewer,
  groupId: string,
): LiveGroupResourceContextAccess {
  return {
    memberEvidence: activeGroupMembershipAuthorizationEvidence(viewer.userId, groupId),
    managerEvidence: viewer.admin
      ? groupManagementAuthorizationEvidence(viewer.admin, [groupId])
      : { sql: "SELECT 1 WHERE 0", bindings: [] },
  };
}

export async function resolveGroupResourceContextAccess(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
): Promise<GroupResourceContextAccess> {
  const member = await hasActiveGroupMembership(db, viewer.userId, groupId);
  const manager = viewer.admin ? await canManageAnyGroup(db, viewer.admin, [groupId]) : false;
  return { member, manager };
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

/** Live member/resource evidence for use inside the protected D1 batch. */
export function memberGroupResourceAuthorizationEvidence<K extends ResourceGrantKind>(
  userId: string,
  groupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): AuthorizationEvidence {
  const definition = getResourceGrantDefinition(kind);
  if (isManagerResourceCapability(definition, capability)) return { sql: "SELECT 1 WHERE 0", bindings: [] };
  const accepted = memberResourceGrantCapabilitiesFor(definition, capability);
  const sharedAccess =
    accepted.length === 0
      ? "0"
      : `EXISTS (
           SELECT 1 FROM ${definition.grantTable} grant_row
            WHERE grant_row.${definition.grantResourceColumn} = resource.id
              AND grant_row.group_id = context_group.id
              AND grant_row.capability IN (${placeholders(accepted)})
         )`;
  return {
    sql: `SELECT 1
            FROM ${definition.resourceTable} resource
            JOIN groups context_group ON context_group.id = ? AND context_group.active = 1
           WHERE resource.id = ?
             AND EXISTS (
               SELECT 1 FROM group_memberships membership
                WHERE membership.group_id = context_group.id
                  AND membership.user_id = ?
                  AND membership.left_at IS NULL
             )
             AND (
               resource.${definition.ownerGroupColumn} = context_group.id
               OR ${sharedAccess}
             )
           LIMIT 1`,
    bindings: [groupId, resourceId, userId, ...accepted],
  };
}

export function prepareMemberGroupResourceAuthorizationGuard<K extends ResourceGrantKind>(
  db: DatabaseLike,
  userId: string,
  groupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): StatementLike {
  return prepareAuthorizationGuard(
    db,
    memberGroupResourceAuthorizationEvidence(userId, groupId, kind, resourceId, capability),
  );
}

/** Proves that a resource is still owned by or shared with one managed group. */
export function groupResourceContextAuthorizationEvidence<K extends ResourceGrantKind>(
  groupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): AuthorizationEvidence {
  const definition = getResourceGrantDefinition(kind);
  const accepted = resourceGrantCapabilitiesFor(definition, capability).filter((candidate) =>
    isManagerResourceCapability(definition, candidate),
  );
  const sharedAccess =
    accepted.length === 0
      ? "0"
      : `EXISTS (
           SELECT 1 FROM ${definition.grantTable} grant_row
            WHERE grant_row.${definition.grantResourceColumn} = resource.id
              AND grant_row.group_id = context_group.id
              AND grant_row.capability IN (${placeholders(accepted)})
         )`;
  return {
    sql: `SELECT 1
            FROM ${definition.resourceTable} resource
            JOIN groups context_group ON context_group.id = ? AND context_group.active = 1
           WHERE resource.id = ?
             AND (
               resource.${definition.ownerGroupColumn} = context_group.id
               OR ${sharedAccess}
             )
           LIMIT 1`,
    bindings: [groupId, resourceId, ...accepted],
  };
}

export function prepareGroupResourceContextAuthorizationGuard<K extends ResourceGrantKind>(
  db: DatabaseLike,
  groupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): StatementLike {
  return prepareAuthorizationGuard(
    db,
    groupResourceContextAuthorizationEvidence(groupId, kind, resourceId, capability),
  );
}

/**
 * Rechecks selected-group management and the exact resource relationship in
 * every protected read batch. This keeps delayed enrichment and aggregate
 * reads behind the same live manager-only capability as their preflight.
 */
export function guardManagedGroupResourceDatabase<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, , ...results] = await db.batch([
        prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
        prepareGroupResourceContextAuthorizationGuard(db, groupId, kind, resourceId, capability),
        ...statements,
      ]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(403, "RESOURCE_CAPABILITY_REQUIRED", "Resource capability is required");
      }
      throw error;
    }
  });
}

async function resourceOwnerGroupId<K extends ResourceGrantKind>(
  db: DatabaseLike,
  kind: K,
  resourceId: string,
): Promise<string | null> {
  const definition = getResourceGrantDefinition(kind);
  const resource = await db
    .prepare(
      `SELECT ${definition.ownerGroupColumn} AS owner_group_id
         FROM ${definition.resourceTable} WHERE id = ?`,
    )
    .bind(resourceId)
    .first<{ owner_group_id: string | null }>();
  return resource?.owner_group_id ?? null;
}

/** Member-session authorization without fabricating a staff identity. */
export async function canMemberAccessGroupResource<K extends ResourceGrantKind>(
  db: DatabaseLike,
  userId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
  throughGroupId?: string,
): Promise<boolean> {
  const definition = getResourceGrantDefinition(kind);
  if (isManagerResourceCapability(definition, capability)) return false;
  const ownerGroupId = await resourceOwnerGroupId(db, kind, resourceId);
  if (!ownerGroupId) return false;
  if (
    (!throughGroupId || throughGroupId === ownerGroupId) &&
    (await hasActiveGroupMembership(db, userId, ownerGroupId))
  ) {
    return true;
  }
  if (throughGroupId === ownerGroupId) return false;

  const accepted = memberResourceGrantCapabilitiesFor(definition, capability);
  if (accepted.length === 0) return false;
  const groupConstraint = throughGroupId ? "AND grant_row.group_id = ?" : "";
  const row = await first<{ authorized: number }>(
    db,
    `SELECT 1 AS authorized
       FROM ${definition.grantTable} grant_row
       JOIN groups grantee ON grantee.id = grant_row.group_id AND grantee.active = 1
       JOIN group_memberships membership ON membership.group_id = grant_row.group_id
        AND membership.user_id = ? AND membership.left_at IS NULL
      WHERE grant_row.${definition.grantResourceColumn} = ?
        AND grant_row.capability IN (${placeholders(accepted)})
        ${groupConstraint}
      LIMIT 1`,
    [userId, resourceId, ...accepted, ...(throughGroupId ? [throughGroupId] : [])],
  );
  return row !== null;
}

/**
 * Shared evaluator for every FK-backed resource grant. Participant capabilities
 * require active membership in the owner or grantee group; management-class
 * capabilities require effective local/inherited management of that group.
 * Management never manufactures the membership required to participate.
 */
export async function canAccessGroupResource<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: AuthAdmin,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
  throughGroupId?: string,
): Promise<boolean> {
  const definition = getResourceGrantDefinition(kind);
  const ownerGroupId = await resourceOwnerGroupId(db, kind, resourceId);
  if (!ownerGroupId) return false;
  const participantCapability = isParticipantResourceCapability(definition, capability);
  if (await canMemberAccessGroupResource(db, actor.id, kind, resourceId, capability, throughGroupId)) return true;
  const ownerContext = !throughGroupId || throughGroupId === ownerGroupId;
  if (
    ownerContext &&
    !participantCapability &&
    hasPermission(actor, "groups:write", { type: "group", id: ownerGroupId })
  ) {
    return true;
  }
  if (participantCapability) return false;
  if (ownerContext && (await canManageAnyGroup(db, actor, [ownerGroupId]))) return true;
  if (throughGroupId === ownerGroupId) return false;

  const acceptedManagerCapabilities = resourceGrantCapabilitiesFor(definition, capability).filter((candidate) =>
    isManagerResourceCapability(definition, candidate),
  );
  if (acceptedManagerCapabilities.length === 0) return false;
  const managerGroups = await all<GroupIdRow>(
    db,
    `SELECT DISTINCT grant_row.group_id
       FROM ${definition.grantTable} grant_row
      WHERE grant_row.${definition.grantResourceColumn} = ?
        AND grant_row.capability IN (${placeholders(acceptedManagerCapabilities)})
        ${throughGroupId ? "AND grant_row.group_id = ?" : ""}`,
    [resourceId, ...acceptedManagerCapabilities, ...(throughGroupId ? [throughGroupId] : [])],
  );
  return canManageAnyGroup(
    db,
    actor,
    managerGroups.map((row) => row.group_id),
  );
}

export async function requireGroupResourceAccess<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: AuthAdmin,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
  throughGroupId?: string,
): Promise<void> {
  if (!(await canAccessGroupResource(db, actor, kind, resourceId, capability, throughGroupId))) {
    throw new AppError(403, "RESOURCE_CAPABILITY_REQUIRED", "Resource capability is required");
  }
}

export function canViewerAccessGroupResource<K extends ResourceGrantKind>(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  throughGroupId: string,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
): Promise<boolean> {
  return viewer.admin
    ? canAccessGroupResource(db, viewer.admin, kind, resourceId, capability, throughGroupId)
    : canMemberAccessGroupResource(db, viewer.userId, kind, resourceId, capability, throughGroupId);
}
