import type { MailingListCreateInput, MailingListUpdateInput } from "../../../../assets/shared/schemas/mailing-lists";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions";
import { translateMailingListWriteError, validateMailingListConfiguration } from "./configuration";
import { MAILING_LIST_COLUMNS, type MailingListRow, toMailingList } from "./record";

export async function createMailingList(db: DatabaseLike, input: MailingListCreateInput, actorUserId: string) {
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
      ),
    ]);
  } catch (error) {
    translateMailingListWriteError(error);
  }
  return loadMailingList(db, id);
}

export async function updateMailingList(
  db: DatabaseLike,
  id: string,
  input: MailingListUpdateInput,
  actorUserId: string,
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
      db.prepare(`UPDATE mailing_lists SET ${setters.join(", ")} WHERE id = ?`).bind(...values),
      prepareReconcileMailingListStatement(db, id, now),
      prepareAuditLog(db, "admin", actorUserId, "mailing_list_updated", "mailing_list", id, input, now),
    ]);
  } catch (error) {
    translateMailingListWriteError(error);
  }
  return loadMailingList(db, id);
}

export async function deleteMailingList(db: DatabaseLike, id: string, actorUserId: string): Promise<void> {
  if (!(await first(db, "SELECT id FROM mailing_lists WHERE id = ?", [id]))) {
    throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  }
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE mailing_lists SET active = 0, archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id),
    prepareReconcileMailingListStatement(db, id, now),
    prepareAuditLog(db, "admin", actorUserId, "mailing_list_archived", "mailing_list", id, {}, now),
  ]);
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
