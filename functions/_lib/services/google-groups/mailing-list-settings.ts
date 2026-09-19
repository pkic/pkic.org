import type { z } from "zod";
import {
  mailingListSyncResponseSchema,
  type mailingListSyncUpdateSchema,
  type mailingListSyncRunSchema,
} from "../../../../assets/shared/schemas/mailing-list-sync";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareScopedAuditLog } from "../audit";
import { requireManagedGroupMailingList, groupMailingListWriteGuards } from "../mailing-list-management/authorization";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";

export async function getMailingListSyncSettings(db: DatabaseLike, actor: AuthAdmin, groupId: string, listId: string) {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  const row = await first<{ enabled: number; revision: number }>(
    db,
    "SELECT enabled, revision FROM mailing_list_sync_settings WHERE mailing_list_id = ?",
    [listId],
  );
  return mailingListSyncResponseSchema.parse({
    synchronization: { enabled: row ? row.enabled === 1 : true, revision: row?.revision ?? 0 },
  });
}
function revisionGuard(db: DatabaseLike, listId: string, revision: number, mustBeEnabled = false) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE COALESCE((SELECT revision FROM mailing_list_sync_settings WHERE mailing_list_id = ?), 0) = ?
    ${mustBeEnabled ? "AND COALESCE((SELECT enabled FROM mailing_list_sync_settings WHERE mailing_list_id = ?), 1) = 1" : ""}`,
    bindings: [listId, revision, ...(mustBeEnabled ? [listId] : [])],
  });
}
function conflict(error: unknown): never {
  if (isAuthorizationGuardFailure(error))
    throw new AppError(
      409,
      "MAILING_LIST_SYNC_CHANGED",
      "Synchronization settings or your permission changed. Reload and retry.",
    );
  throw error;
}
export async function updateMailingListSyncSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
  input: z.infer<typeof mailingListSyncUpdateSchema>,
) {
  await requireManagedGroupMailingList(db, actor, groupId, listId);
  const now = nowIso();
  try {
    await db.batch([
      ...groupMailingListWriteGuards(db, actor, groupId, listId),
      revisionGuard(db, listId, input.expectedRevision),
      db
        .prepare(
          `INSERT INTO mailing_list_sync_settings (mailing_list_id, enabled, revision, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(mailing_list_id) DO UPDATE SET enabled = excluded.enabled, revision = mailing_list_sync_settings.revision + 1, updated_at = excluded.updated_at`,
        )
        .bind(listId, input.enabled ? 1 : 0, now),
      prepareScopedAuditLog(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "mailing_list_sync_settings_updated",
        "mailing_list",
        listId,
        { enabled: input.enabled },
        now,
      ),
      ...(input.enabled ? [prepareJobWake(db, "google_groups_sync")] : []),
    ]);
  } catch (error) {
    conflict(error);
  }
  return getMailingListSyncSettings(db, actor, groupId, listId);
}
export async function runMailingListSync(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  listId: string,
  input: z.infer<typeof mailingListSyncRunSchema>,
) {
  const settings = await getMailingListSyncSettings(db, actor, groupId, listId);
  if (!settings.synchronization.enabled)
    throw new AppError(409, "MAILING_LIST_SYNC_PAUSED", "Enable synchronization before requesting a sync.");
  const now = nowIso();
  const requestId = uuid();
  let queued = 0;
  try {
    const result = await db.batch([
      ...groupMailingListWriteGuards(db, actor, groupId, listId),
      revisionGuard(db, listId, input.expectedRevision, true),
      prepareReconcileMailingListStatement(db, listId, now),
      db
        .prepare(
          `INSERT INTO google_groups_sync_queue
        (id, user_id, action, google_group_email, idempotency_key, status, attempts, next_attempt_at, created_at)
        SELECT 'google-sync:' || lower(hex(randomblob(16))), desired.user_id, desired.desired_action, desired.google_group_email,
          'mailing-list-sync:' || ? || ':' || desired.user_id || ':' || desired.google_group_email, 'pending', 0, ?, ?
        FROM google_groups_membership_desired_state desired JOIN mailing_lists list ON list.email = desired.google_group_email
        WHERE list.id = ? AND NOT EXISTS (SELECT 1 FROM google_groups_sync_queue queue
          WHERE queue.user_id = desired.user_id AND queue.google_group_email = desired.google_group_email
            AND queue.generation = desired.generation AND queue.status IN ('pending', 'processing'))`,
        )
        .bind(requestId, now, now, listId),
      db
        .prepare(
          `UPDATE google_groups_sync_queue SET next_attempt_at = ? WHERE status = 'pending'
        AND google_group_email IN (SELECT email FROM mailing_lists WHERE id = ?)`,
        )
        .bind(now, listId),
      prepareScopedAuditLog(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "mailing_list_sync_requested",
        "mailing_list",
        listId,
        { requestId },
        now,
      ),
      prepareJobWake(db, "google_groups_sync"),
    ]);
    queued = result[5].meta?.changes ?? 0;
  } catch (error) {
    conflict(error);
  }
  return { queued };
}
