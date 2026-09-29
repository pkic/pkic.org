import type {
  GroupMailingListCreateInput,
  GroupMailingListUpdateInput,
} from "../../../../assets/shared/schemas/mailing-lists";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { prepareGroupManagementAuthorizationGuard, requireGroupManagement } from "../groups/governance";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions";
import {
  groupMailingListWriteGuards,
  requireManagedGroupMailingList,
  type MailingListMutationOptions,
} from "./authorization";
import { translateMailingListWriteError, validateMailingListConfiguration } from "./configuration";
import { loadMailingList } from "./read-model";
import { MAILING_LIST_COLUMNS, type MailingListRow, toMailingList } from "./record";

type MailingListCreateCommandInput = GroupMailingListCreateInput & { groupId: string };

export async function createMailingList(
  db: DatabaseLike,
  input: MailingListCreateCommandInput,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  const now = nowIso();
  const id = uuid();
  await validateMailingListConfiguration(db, {
    purpose: input.purpose,
    groupId: input.groupId,
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
          input.groupId,
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
  input: GroupMailingListUpdateInput,
  actorUserId: string,
  options: MailingListMutationOptions = {},
) {
  const existing = await first<MailingListRow>(db, `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists WHERE id = ?`, [
    id,
  ]);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  await validateMailingListConfiguration(db, {
    purpose: input.purpose ?? existing.purpose,
    groupId: existing.group_id,
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

/** Group-scoped commands retain one write implementation while binding ownership and authorization atomically. */
export async function createGroupMailingList(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  input: GroupMailingListCreateInput,
) {
  await requireGroupManagement(db, actor, groupId);
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
  input: GroupMailingListUpdateInput,
) {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  return updateMailingList(db, listId, input, actor.id, {
    authorizationGuards: groupMailingListWriteGuards(db, actor, groupId, listId),
    auditScope: { type: "group", id: groupId },
  });
}

function addMailingListSetters(input: GroupMailingListUpdateInput, setters: string[], values: unknown[]): void {
  const add = (column: string, value: unknown) => {
    setters.push(`${column} = ?`);
    values.push(value);
  };
  if (input.email !== undefined) add("email", input.email);
  if (input.label !== undefined) add("label", input.label);
  if (input.purpose !== undefined) add("purpose", input.purpose);
  if (input.primaryDiscussion !== undefined) add("is_primary_discussion", input.primaryDiscussion ? 1 : 0);
  if (input.subscriptionDefault !== undefined) add("subscription_default", input.subscriptionDefault);
  if (input.postingPolicy !== undefined) add("posting_policy", input.postingPolicy);
  if (input.moderationPolicy !== undefined) add("moderation_policy", input.moderationPolicy);
  if (input.autoSyncCategories !== undefined) {
    add("auto_sync_categories_json", input.autoSyncCategories ? JSON.stringify(input.autoSyncCategories) : null);
  }
  if (input.active !== undefined) add("active", input.active ? 1 : 0);
}
