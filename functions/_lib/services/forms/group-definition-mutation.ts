import type {
  GroupFormDefinitionCreateInput,
  GroupFormDefinitionUpdateInput,
} from "../../../../assets/shared/schemas/group-forms";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { prepareGroupResourceContextAuthorizationGuard, requireGroupResourceAccess } from "../resource-grants";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import { getGroupFormDefinition } from "./group-placement-read";
import { createManagedForm, updateManagedForm } from "./management";
import { getFormDefinitionByPlacement } from "./read";

function authorizationChanged(): AppError {
  return new AppError(
    409,
    "GROUP_FORM_AUTHORIZATION_CHANGED",
    "Group form-management authority changed while the definition was being saved",
  );
}

function prepareDefinitionOwnershipGuard(db: DatabaseLike, groupId: string, placementId: string, formId: string) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM form_placements placement
            JOIN forms form ON form.id = placement.form_id
           WHERE placement.id = ? AND placement.form_id = ?
             AND placement.owner_group_id = ?
             AND form.scope_type = 'community' AND form.scope_ref = ?`,
    bindings: [placementId, formId, groupId, groupId],
  });
}

export async function createGroupFormDefinition(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  groupId: string,
  input: GroupFormDefinitionCreateInput,
) {
  await requireGroupManagement(db, actor, groupId);
  try {
    const created = await createManagedForm(db, actor.id, { type: "group", ref: groupId, groupId }, input, {
      authorizationGuards: [prepareGroupManagementAuthorizationGuard(db, actor, [groupId])],
      auditScope: { type: "group", id: groupId },
    });
    return getGroupFormDefinition(db, { userId: actor.id, admin: actor }, groupId, created.placementId);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw authorizationChanged();
    throw error;
  }
}

export async function updateGroupFormDefinition(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  groupId: string,
  placementId: string,
  input: GroupFormDefinitionUpdateInput,
) {
  await requireGroupResourceAccess(db, actor, "formPlacement", placementId, "manage", groupId);
  const definition = await getFormDefinitionByPlacement(db, placementId);
  if (!definition) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  if (
    definition.placement?.ownerGroupId !== groupId ||
    definition.scopeType !== "community" ||
    definition.scopeRef !== groupId
  ) {
    throw new AppError(403, "FORM_DEFINITION_OWNER_REQUIRED", "Only the form definition's owning group may edit it");
  }

  try {
    await updateManagedForm(
      db,
      actor.id,
      { id: definition.id, key: definition.key, updated_at: definition.formUpdatedAt },
      input,
      {
        authorizationGuards: [
          prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
          prepareGroupResourceContextAuthorizationGuard(db, groupId, "formPlacement", placementId, "manage"),
          prepareDefinitionOwnershipGuard(db, groupId, placementId, definition.id),
        ],
        auditScope: { type: "group", id: groupId },
        auditAction: "group_form_definition_updated",
      },
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) throw authorizationChanged();
    throw error;
  }
  return getGroupFormDefinition(db, { userId: actor.id, admin: actor }, groupId, placementId);
}
