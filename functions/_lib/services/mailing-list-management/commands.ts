import type { MailingListCreateInput, MailingListUpdateInput } from "../../../../assets/shared/schemas/mailing-lists";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog, type AuditScope } from "../audit";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions";
import { translateMailingListWriteError, validateMailingListConfiguration } from "./configuration";
import { MAILING_LIST_COLUMNS, type MailingListRow, toMailingList } from "./record";

interface MailingListMutationOptions {
  authorizationGuards?: StatementLike[];
  auditScope?: AuditScope;
}

export async function createMailingList(
  db: DatabaseLike,
  input: MailingListCreateInput,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  const now = nowIso();
  const id = uuid();
  await validateMailingListConfiguration(db, {
    purpose: input.purpose,
    groupId: input.groupId ?? null,
    primaryDiscussion: input.primaryDiscussion ?? false,
    subscriptionDefault: input.subscriptionDefault ?? "none",
  });
  try {
    await db.batch([
      ...(options.authorizationGuards ?? []),
      db
        .prepare(
          `INSERT INTO mailing_lists
             (id, email, label, purpose, group_id, is_primary_discussion, subscription_default,
              posting_policy, moderation_policy, auto_sync_categories_json, active, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          id,
          input.email,
          input.label,
          input.purpose,
          input.groupId ?? null,
          input.primaryDiscussion ? 1 : 0,
          input.subscriptionDefault ?? "none",
          input.postingPolicy ?? "subscribers",
          input.moderationPolicy ?? "moderated",
          input.autoSyncCategories ? JSON.stringify(input.autoSyncCategories) : null,
          input.active === false ? 0 : 1,
          now,
          now,
        ),
      prepareReconcileMailingListStatement(db, id, now),
      prepareAuditLog(
        db,
        "admin",
        actorUserId,
        "mailing_list_created",
        "mailing_list",
        id,
        { email: input.email },
        now,
        null,
        options.auditScope,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MAILING_LIST_AUTHORIZATION_CHANGED", "Group-management authority changed while saving");
    }
    translateMailingListWriteError(error);
  }
  return loadMailingList(db, id);
}

export async function updateMailingList(
  db: DatabaseLike,
  id: string,
  input: MailingListUpdateInput,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  const existing = await first<MailingListRow>(db, `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists WHERE id = ?`, [
    id,
  ]);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  await validateMailingListConfiguration(db, {
    purpose: input.purpose ?? existing.purpose,
    groupId: input.groupId === undefined ? existing.group_id : input.groupId,
    primaryDiscussion: input.primaryDiscussion ?? existing.is_primary_discussion === 1,
    subscriptionDefault: input.subscriptionDefault ?? existing.subscription_default,
  });
  const setters: string[] = [];
  const values: unknown[] = [];
  addMailingListSetters(input, setters, values);
  if (setters.length === 0) return toMailingList(existing);
  const now = nowIso();
  setters.push("updated_at = ?");
  values.push(now, id);
  try {
    await db.batch([
      ...(options.authorizationGuards ?? []),
      db.prepare(`UPDATE mailing_lists SET ${setters.join(", ")} WHERE id = ?`).bind(...values),
      prepareReconcileMailingListStatement(db, id, now),
      prepareAuditLog(
        db,
        "admin",
        actorUserId,
        "mailing_list_updated",
        "mailing_list",
        id,
        input,
        now,
        null,
        options.auditScope,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MAILING_LIST_AUTHORIZATION_CHANGED", "Group-management authority changed while saving");
    }
    translateMailingListWriteError(error);
  }
  return loadMailingList(db, id);
}

export async function deleteMailingList(
  db: DatabaseLike,
  id: string,
  actorUserId: string,
  options: MailingListMutationOptions = {},
): Promise<void> {
  if (!(await first(db, "SELECT id FROM mailing_lists WHERE id = ?", [id]))) {
    throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  }
  const now = nowIso();
  try {
    await db.batch([
      ...(options.authorizationGuards ?? []),
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
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "MAILING_LIST_AUTHORIZATION_CHANGED", "Group-management authority changed while saving");
    }
    throw error;
  }
}

function groupMailingListOwnershipGuard(db: DatabaseLike, listId: string, groupId: string): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 FROM mailing_lists WHERE id = ? AND group_id = ?",
    bindings: [listId, groupId],
  });
}

/** Group-scoped commands retain one write implementation while binding ownership and authorization atomically. */
export async function createGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  input: MailingListCreateInput,
) {
  await requireGroupManagement(db, actor, groupId);
  if (input.groupId !== undefined && input.groupId !== groupId) {
    throw new AppError(422, "MAILING_LIST_GROUP_MISMATCH", "A group mailing list cannot be assigned to another group");
  }
  return createMailingList(db, { ...input, groupId }, actor.id, {
    authorizationGuards: [prepareGroupManagementAuthorizationGuard(db, actor, [groupId])],
    auditScope: { type: "group", id: groupId },
  });
}

export async function updateGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
  input: MailingListUpdateInput,
) {
  await requireGroupManagement(db, actor, groupId);
  const existing = await first<{ group_id: string | null }>(db, "SELECT group_id FROM mailing_lists WHERE id = ?", [
    listId,
  ]);
  if (!existing || existing.group_id !== groupId) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  if (input.groupId !== undefined && input.groupId !== groupId) {
    throw new AppError(422, "MAILING_LIST_GROUP_MISMATCH", "A group mailing list cannot be assigned to another group");
  }
  return updateMailingList(db, listId, input, actor.id, {
    authorizationGuards: [
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      groupMailingListOwnershipGuard(db, listId, groupId),
    ],
    auditScope: { type: "group", id: groupId },
  });
}

export async function archiveGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
): Promise<void> {
  await requireGroupManagement(db, actor, groupId);
  const existing = await first<{ group_id: string | null }>(db, "SELECT group_id FROM mailing_lists WHERE id = ?", [
    listId,
  ]);
  if (!existing || existing.group_id !== groupId) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  await deleteMailingList(db, listId, actor.id, {
    authorizationGuards: [
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      groupMailingListOwnershipGuard(db, listId, groupId),
    ],
    auditScope: { type: "group", id: groupId },
  });
}

function addMailingListSetters(input: MailingListUpdateInput, setters: string[], values: unknown[]): void {
  const add = (column: string, value: unknown) => {
    setters.push(`${column} = ?`);
    values.push(value);
  };
  if (input.email !== undefined) add("email", input.email);
  if (input.label !== undefined) add("label", input.label);
  if (input.purpose !== undefined) add("purpose", input.purpose);
  if (input.groupId !== undefined) add("group_id", input.groupId);
  if (input.primaryDiscussion !== undefined) add("is_primary_discussion", input.primaryDiscussion ? 1 : 0);
  if (input.subscriptionDefault !== undefined) add("subscription_default", input.subscriptionDefault);
  if (input.postingPolicy !== undefined) add("posting_policy", input.postingPolicy);
  if (input.moderationPolicy !== undefined) add("moderation_policy", input.moderationPolicy);
  if (input.autoSyncCategories !== undefined) {
    add("auto_sync_categories_json", input.autoSyncCategories ? JSON.stringify(input.autoSyncCategories) : null);
  }
  if (input.active !== undefined) add("active", input.active ? 1 : 0);
}

async function loadMailingList(db: DatabaseLike, id: string) {
  const row = await first<MailingListRow>(db, `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists WHERE id = ?`, [id]);
  if (!row) throw new AppError(500, "MAILING_LIST_READ_FAILED", "Failed to read the mailing list after mutation");
  return toMailingList(row);
}
