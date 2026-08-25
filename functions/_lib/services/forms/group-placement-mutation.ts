import type { GroupFormPlacementUpdateInput } from "../../../../assets/shared/schemas/group-forms";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { requireGroupResourceAccess } from "../resource-grants";
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
  await updateManagedFormPlacement(db, actor.id, form.id, placementId, input, { type: "group", id: groupId });
  return getGroupFormDefinition(db, { userId: actor.id, admin: actor }, groupId, placementId);
}
