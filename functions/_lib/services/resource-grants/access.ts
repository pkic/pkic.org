import { hasPermission } from "../../auth/permissions";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { canManageAnyGroup } from "../groups";
import {
  getResourceGrantDefinition,
  isManagerResourceCapability,
  isParticipantResourceCapability,
  type ResourceGrantCapability,
  type ResourceGrantKind,
} from "./definitions";

interface GroupIdRow {
  group_id: string;
}

async function hasActiveGroupMembership(db: DatabaseLike, userId: string, groupId: string): Promise<boolean> {
  return (
    (await first<{ authorized: number }>(
      db,
      `SELECT 1 AS authorized FROM group_memberships
        WHERE user_id = ? AND group_id = ? AND left_at IS NULL LIMIT 1`,
      [userId, groupId],
    )) !== null
  );
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
): Promise<boolean> {
  const definition = getResourceGrantDefinition(kind);
  const resource = await db
    .prepare(
      `SELECT ${definition.ownerGroupColumn} AS owner_group_id
         FROM ${definition.resourceTable} WHERE id = ?`,
    )
    .bind(resourceId)
    .first<{ owner_group_id: string | null }>();
  if (!resource?.owner_group_id) return false;
  const ownerGroupId = resource.owner_group_id;
  const participantCapability = isParticipantResourceCapability(definition, capability);
  if (participantCapability) {
    if (await hasActiveGroupMembership(db, actor.id, ownerGroupId)) return true;
  } else if (hasPermission(actor, "groups:write", { type: "group", id: ownerGroupId })) {
    return true;
  }
  const managerCapability = isManagerResourceCapability(definition, capability);
  if (!participantCapability && managerCapability) {
    if (await canManageAnyGroup(db, actor, [ownerGroupId])) return true;
  } else if (!participantCapability && (await hasActiveGroupMembership(db, actor.id, ownerGroupId))) {
    return true;
  }

  const exactMemberGroups = managerCapability
    ? []
    : await all<GroupIdRow>(
        db,
        `SELECT grant_row.group_id
           FROM ${definition.grantTable} grant_row
           JOIN group_memberships membership ON membership.group_id = grant_row.group_id
            AND membership.user_id = ? AND membership.left_at IS NULL
          WHERE grant_row.${definition.grantResourceColumn} = ? AND grant_row.capability = ?`,
        [actor.id, resourceId, capability],
      );
  if (exactMemberGroups.length > 0) return true;

  if (participantCapability) return false;

  const managerGroups = await all<GroupIdRow>(
    db,
    `SELECT DISTINCT grant_row.group_id
       FROM ${definition.grantTable} grant_row
      WHERE grant_row.${definition.grantResourceColumn} = ?
        AND grant_row.capability IN (?, 'manage')`,
    [resourceId, capability],
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
): Promise<void> {
  if (!(await canAccessGroupResource(db, actor, kind, resourceId, capability))) {
    throw new AppError(403, "RESOURCE_CAPABILITY_REQUIRED", "Resource capability is required");
  }
}
