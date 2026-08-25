import type { ScopedAuditLogListQuery } from "../../../../assets/shared/schemas/audit-log";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { listExactAuditLogScope } from "../audit-log-read";
import { requireGroupManagement } from "./governance";
import { getGroup } from "./read-model";

/** Group-context authorization adapter over the canonical audit read model. */
export async function listGroupAuditLog(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  query: ScopedAuditLogListQuery,
) {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, actor, group.id);
  return listExactAuditLogScope(db, "group", group.id, query);
}
