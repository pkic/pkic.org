import { hasPermission } from "../../auth/permissions";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { canManageAnyGroup } from "../groups/governance";
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

export async function hasActiveGroupMembership(db: DatabaseLike, userId: string, groupId: string): Promise<boolean> {
  return (
    (await first<{ authorized: number }>(
      db,
      `SELECT 1 AS authorized
         FROM group_memberships membership
         JOIN groups group_row ON group_row.id = membership.group_id AND group_row.active = 1
        WHERE membership.user_id = ? AND membership.group_id = ? AND membership.left_at IS NULL
        LIMIT 1`,
      [userId, groupId],
    )) !== null
  );
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
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
