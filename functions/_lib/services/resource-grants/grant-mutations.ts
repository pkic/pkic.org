import { AppError } from "../../errors";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { D1StatementResult, DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareAuditLogWhen, prepareScopedAuditLogAfterOneChange } from "../audit";
import { getGroup } from "../groups";
import { prepareGroupManagementAuthorizationGuard } from "../groups/governance";
import { getResourceGrantDefinition, isResourceGrantCapability, type ResourceGrantKind } from "./definitions";
import { getResourceGroupGrant, resolveOwnedResource } from "./read";
import { prepareGrantReconciliationStatements } from "./grant-reconciliation";
import type { ResourceGrantMutationInput, ResourceGroupGrant } from "./types";

async function commitResourceGrantBatch(
  db: DatabaseLike,
  statements: readonly StatementLike[],
): Promise<D1StatementResult[]> {
  try {
    return await db.batch([...statements]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "RESOURCE_GRANT_AUTHORIZATION_CHANGED",
        "Resource-sharing authority changed while the update was being saved",
      );
    }
    throw error;
  }
}

export async function grantResourceToGroup<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  ownerGroupIdOrSlug: string,
  kind: K,
  resourceId: string,
  input: ResourceGrantMutationInput<K>,
): Promise<{ grant: ResourceGroupGrant<K>; created: boolean }> {
  const definition = getResourceGrantDefinition(kind);
  if (!isResourceGrantCapability(definition, input.capability)) {
    throw new AppError(400, "RESOURCE_GRANT_CAPABILITY_INVALID", "Unsupported resource grant capability");
  }
  const { ownerGroupId } = await resolveOwnedResource(db, kind, ownerGroupIdOrSlug, resourceId, actor);
  const grantee = await getGroup(db, input.granteeGroupId);
  if (!grantee || !grantee.active) throw new AppError(404, "GRANTEE_GROUP_NOT_FOUND", "Active grantee group not found");
  if (grantee.id === ownerGroupId) {
    throw new AppError(409, "RESOURCE_OWNER_GRANT_REDUNDANT", "The owning group already controls this resource");
  }
  const now = nowIso();
  const reconciliation = prepareGrantReconciliationStatements(db, kind, resourceId, input.capability, now);
  const results = await commitResourceGrantBatch(db, [
    prepareGroupManagementAuthorizationGuard(db, actor, [ownerGroupId]),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM ${definition.resourceTable}
             WHERE id = ? AND ${definition.ownerGroupColumn} = ?`,
      bindings: [resourceId, ownerGroupId],
    }),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM groups WHERE id = ? AND active = 1 AND id <> ?",
      bindings: [grantee.id, ownerGroupId],
    }),
    db
      .prepare(
        `INSERT OR IGNORE INTO ${definition.grantTable}
           (${definition.grantResourceColumn}, group_id, capability, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(resourceId, grantee.id, input.capability, actor.id, now),
    prepareAuditLogWhen(db, {
      actorType: "admin",
      actorId: actor.id,
      action: `${definition.auditEntityType}_group_grant_created`,
      entityType: definition.auditEntityType,
      entityId: resourceId,
      details: { granteeGroupId: grantee.id, capability: input.capability },
      conditionSql: "SELECT 1 WHERE changes() = 1",
      conditionBindings: [],
      createdAt: now,
      scope: { type: "group", id: ownerGroupId },
    }),
    ...reconciliation,
  ]);
  const grant = await getResourceGroupGrant(db, kind, resourceId, grantee.id, input.capability);
  if (!grant) throw new AppError(500, "RESOURCE_GRANT_READ_FAILED", "Failed to read resource grant after mutation");
  return { grant, created: Number(results[3]?.meta?.changes ?? 0) === 1 };
}

export async function revokeResourceGroupGrant<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  ownerGroupIdOrSlug: string,
  kind: K,
  resourceId: string,
  input: ResourceGrantMutationInput<K>,
): Promise<void> {
  const definition = getResourceGrantDefinition(kind);
  if (!isResourceGrantCapability(definition, input.capability)) {
    throw new AppError(400, "RESOURCE_GRANT_CAPABILITY_INVALID", "Unsupported resource grant capability");
  }
  const { ownerGroupId } = await resolveOwnedResource(db, kind, ownerGroupIdOrSlug, resourceId, actor);
  const now = nowIso();
  const reconciliation = prepareGrantReconciliationStatements(db, kind, resourceId, input.capability, now);
  try {
    await commitResourceGrantBatch(db, [
      prepareGroupManagementAuthorizationGuard(db, actor, [ownerGroupId]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM ${definition.resourceTable}
               WHERE id = ? AND ${definition.ownerGroupColumn} = ?`,
        bindings: [resourceId, ownerGroupId],
      }),
      db
        .prepare(
          `DELETE FROM ${definition.grantTable}
            WHERE ${definition.grantResourceColumn} = ? AND group_id = ? AND capability = ?`,
        )
        .bind(resourceId, input.granteeGroupId, input.capability),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: ownerGroupId },
        "admin",
        actor.id,
        `${definition.auditEntityType}_group_grant_revoked`,
        definition.auditEntityType,
        resourceId,
        { granteeGroupId: input.granteeGroupId, capability: input.capability },
        now,
      ),
      ...reconciliation,
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(404, "RESOURCE_GRANT_NOT_FOUND", "Resource grant not found");
    }
    throw error;
  }
}
