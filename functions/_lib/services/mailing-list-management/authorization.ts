import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { prepareGroupManagementAuthorizationGuard } from "../groups/governance";
import { prepareGroupResourceContextAuthorizationGuard, requireGroupResourceAccess } from "../resource-grants";
import type { AuditScope } from "../audit";

/** What a list write commits under: the guards it races against, and whose audit trail it belongs to. */
export interface MailingListMutationOptions {
  authorizationGuards?: StatementLike[];
  auditScope?: AuditScope;
}

/**
 * A list is reachable only through a group that may manage it, and a list
 * owned elsewhere is not merely forbidden through the wrong path — it is
 * absent, so a manager cannot use the refusal to learn that it exists.
 */
export async function requireManagedGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
): Promise<void> {
  const list = await first<{ group_id: string }>(db, "SELECT group_id FROM mailing_lists WHERE id = ?", [listId]);
  if (!list) {
    throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  }
  try {
    await requireGroupResourceAccess(db, actor, "mailingList", listId, "manage", groupId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RESOURCE_CAPABILITY_REQUIRED" && list.group_id !== groupId) {
      throw new AppError(404, "NOT_FOUND", "Mailing list not found");
    }
    throw error;
  }
}

/**
 * The guards every group-scoped list write commits with, so authority lost
 * between the check above and the batch aborts the write instead of racing
 * through it.
 */
export function groupMailingListWriteGuards(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
): StatementLike[] {
  return [
    prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
    prepareGroupResourceContextAuthorizationGuard(db, groupId, "mailingList", listId, "manage"),
  ];
}
