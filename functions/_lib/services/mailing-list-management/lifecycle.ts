import type { MailingListLifecycleTransitionInput } from "../../../../assets/shared/schemas/mailing-lists";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions";
import {
  groupMailingListWriteGuards,
  requireManagedGroupMailingList,
  type MailingListMutationOptions,
} from "./authorization";
import { translateMailingListWriteError } from "./configuration";
import { loadMailingList } from "./read-model";

/**
 * What still leans on a list, and therefore why it cannot simply disappear.
 *
 * Archiving is the ordinary end of a list's life: the configuration, the
 * choices people made about it, and the provider's copy all survive. Deleting
 * is for the list that was a mistake or a trial — one nobody answered for,
 * nobody else was given, and the provider never carried. These three
 * questions are what separates the two, and the migration repeats them as a
 * trigger so no other write path can lose the history either.
 */
const DELETE_DEPENDENCIES = [
  {
    code: "MAILING_LIST_HAS_SUBSCRIPTION_HISTORY",
    message: "Someone's subscription choice is recorded on this list. Archive it instead of deleting it.",
    sql: "SELECT 1 FROM mailing_list_subscription_preferences WHERE mailing_list_id = ?",
    bindings: (list: MailingListLifecycleRow) => [list.id],
  },
  {
    code: "MAILING_LIST_SHARED_WITH_GROUP",
    message: "This list is shared with another group. Revoke the sharing before deleting it.",
    sql: "SELECT 1 FROM mailing_list_group_grants WHERE mailing_list_id = ?",
    bindings: (list: MailingListLifecycleRow) => [list.id],
  },
  {
    code: "MAILING_LIST_HAS_DELIVERY_HISTORY",
    message: "This list already exists at the mail provider with members on it. Archive it instead of deleting it.",
    sql: `SELECT 1 FROM google_groups_membership_desired_state WHERE google_group_email = ?
          UNION ALL
          SELECT 1 FROM google_groups_sync_queue WHERE google_group_email = ? AND processed_at IS NULL`,
    bindings: (list: MailingListLifecycleRow) => [list.email, list.email],
  },
] as const;

interface MailingListLifecycleRow {
  id: string;
  email: string;
  active: number;
  archived_at: string | null;
}

async function requireMailingList(db: DatabaseLike, id: string): Promise<MailingListLifecycleRow> {
  const row = await first<MailingListLifecycleRow>(
    db,
    "SELECT id, email, active, archived_at FROM mailing_lists WHERE id = ?",
    [id],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  return row;
}

async function commitLifecycleChange(
  db: DatabaseLike,
  statements: StatementLike[],
  options: MailingListMutationOptions,
): Promise<void> {
  try {
    await db.batch([...(options.authorizationGuards ?? []), ...statements]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MAILING_LIST_AUTHORIZATION_CHANGED", "Group-management authority changed while saving");
    }
    translateMailingListWriteError(error);
  }
}

/** Retires a list without losing anything: the configuration, its history, and the provider's copy all stay. */
export async function archiveMailingList(
  db: DatabaseLike,
  id: string,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  await requireMailingList(db, id);
  const now = nowIso();
  await commitLifecycleChange(
    db,
    [
      db
        .prepare("UPDATE mailing_lists SET active = 0, archived_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, id),
      prepareReconcileMailingListStatement(db, id, now),
      prepareAuditLog(
        db,
        "admin",
        actorUserId,
        "mailing_list_archived",
        "mailing_list",
        id,
        {},
        now,
        null,
        options.auditScope,
      ),
    ],
    options,
  );
  return loadMailingList(db, id);
}

/**
 * Puts an archived list back into service. A group may hold only one active
 * primary discussion list, so a restore that would make a second one is
 * refused by the same unique index that guards an ordinary edit.
 */
export async function restoreMailingList(
  db: DatabaseLike,
  id: string,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  await requireMailingList(db, id);
  const now = nowIso();
  await commitLifecycleChange(
    db,
    [
      db.prepare("UPDATE mailing_lists SET active = 1, archived_at = NULL, updated_at = ? WHERE id = ?").bind(now, id),
      prepareReconcileMailingListStatement(db, id, now),
      prepareAuditLog(
        db,
        "admin",
        actorUserId,
        "mailing_list_restored",
        "mailing_list",
        id,
        {},
        now,
        null,
        options.auditScope,
      ),
    ],
    options,
  );
  return loadMailingList(db, id);
}

/** Removes a list nothing depends on, and refuses — naming the dependency — when something does. */
export async function deleteMailingList(
  db: DatabaseLike,
  id: string,
  actorUserId: string,
  options: MailingListMutationOptions = {},
): Promise<void> {
  const list = await requireMailingList(db, id);
  for (const dependency of DELETE_DEPENDENCIES) {
    if (await first(db, dependency.sql, dependency.bindings(list))) {
      throw new AppError(409, dependency.code, dependency.message);
    }
  }
  const now = nowIso();
  await commitLifecycleChange(
    db,
    [
      db.prepare("DELETE FROM mailing_lists WHERE id = ?").bind(id),
      // The list is gone; the record that it existed and who removed it is not.
      prepareAuditLog(
        db,
        "admin",
        actorUserId,
        "mailing_list_deleted",
        "mailing_list",
        id,
        { email: list.email },
        now,
        null,
        options.auditScope,
      ),
    ],
    options,
  );
}

/** Group-scoped lifecycle: one authorization story for both directions of the state. */
export async function transitionGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
  input: MailingListLifecycleTransitionInput,
) {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  const options: MailingListMutationOptions = {
    authorizationGuards: groupMailingListWriteGuards(db, actor, groupId, listId),
    auditScope: { type: "group", id: groupId },
  };
  return input.transition === "archive"
    ? archiveMailingList(db, listId, actor.id, options)
    : restoreMailingList(db, listId, actor.id, options);
}

export async function deleteGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
): Promise<void> {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  await deleteMailingList(db, listId, actor.id, {
    authorizationGuards: groupMailingListWriteGuards(db, actor, groupId, listId),
    auditScope: { type: "group", id: groupId },
  });
}
