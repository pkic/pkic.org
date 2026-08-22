import type {
  AdminWorkingGroupSummary,
  WorkingGroupUpdateInput,
} from "../../../../assets/shared/schemas/working-groups";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { getAdminWorkingGroupDetail } from "./read-model";

export async function updateWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  id: string,
  patch: WorkingGroupUpdateInput,
): Promise<AdminWorkingGroupSummary> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE id = ?", [id]);
  if (!existing) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  if (patch.name !== undefined) {
    const nameCollision = await first<{ id: string }>(
      db,
      "SELECT id FROM working_groups WHERE lower(name) = lower(?) AND id != ?",
      [patch.name, id],
    );
    if (nameCollision) {
      throw new AppError(409, "DUPLICATE", "A working group with this name already exists");
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    setClauses.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    setClauses.push("description = ?");
    values.push(patch.description);
  }
  if (patch.mailingListEmail !== undefined) {
    setClauses.push("mailing_list_email = ?");
    values.push(patch.mailingListEmail);
  }
  if (patch.minEndorsersForBallot !== undefined) {
    setClauses.push("min_endorsers_for_ballot = ?");
    values.push(patch.minEndorsersForBallot);
  }
  if (patch.active !== undefined) {
    setClauses.push("active = ?");
    values.push(patch.active ? 1 : 0);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso(), id);
    await db.batch([
      db.prepare(`UPDATE working_groups SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
      prepareAuditLog(db, "admin", actorUserId, "working_group_updated", "working_group", id, patch),
    ]);
  }

  const detail = await getAdminWorkingGroupDetail(db, id);
  if (!detail) {
    throw new AppError(500, "WORKING_GROUP_UPDATE_FAILED", "Failed to load working group after update");
  }
  return detail;
}
