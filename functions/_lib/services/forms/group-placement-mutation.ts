import type { GroupFormPlacementUpdateInput } from "../../../../assets/shared/schemas/group-forms";
import { AppError } from "../../errors";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { prepareGroupResourceContextAuthorizationGuard, requireGroupResourceAccess } from "../resource-grants";
import { prepareGroupManagementAuthorizationGuard } from "../groups/governance";
import { getGroupFormDefinition } from "./group-placement-read";
import { updateManagedFormPlacement } from "./placements";
import { getFormDefinitionByPlacement } from "./read";

export async function updateGroupFormPlacement(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  groupId: string,
  placementId: string,
  input: GroupFormPlacementUpdateInput,
) {
  await requireGroupResourceAccess(db, actor, "formPlacement", placementId, "manage", groupId);
  const form = await getFormDefinitionByPlacement(db, placementId);
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  try {
    await updateManagedFormPlacement(db, actor.id, form.id, placementId, input, { type: "group", id: groupId }, [
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      prepareGroupResourceContextAuthorizationGuard(db, groupId, "formPlacement", placementId, "manage"),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "FORM_PLACEMENT_AUTHORIZATION_CHANGED",
        "Form-management authority changed while the placement was being saved",
      );
    }
    throw error;
  }
  return getGroupFormDefinition(db, { userId: actor.id, admin: actor }, groupId, placementId);
}
