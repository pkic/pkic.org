import type { z } from "zod";
import {
  groupMailingSyncResponseSchema,
  type groupMailingSyncUpdateSchema,
  type groupMailingSyncRunSchema,
} from "../../../../assets/shared/schemas/group-mailing-sync";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { prepareScopedAuditLog } from "../audit";
import { requireGroupManagement, prepareGroupManagementAuthorizationGuard } from "../groups/governance";
import { prepareReconcileGroupMailingListSubscriptionsStatement } from "../mailing-list-subscriptions";
import { requestJobWake } from "../scheduled-jobs/dispatcher";

export async function getGroupMailingSyncSettings(db: DatabaseLike, actor: AuthAdmin, groupId: string) {
  await requireGroupManagement(db, actor, groupId);
  const row = await first<{ enabled: number; revision: number }>(
    db,
    "SELECT enabled, revision FROM group_mailing_sync_settings WHERE group_id = ?",
    [groupId],
  );
  return groupMailingSyncResponseSchema.parse({
    synchronization: { enabled: row ? row.enabled === 1 : true, revision: row?.revision ?? 0 },
  });
}
function revisionGuard(db: DatabaseLike, groupId: string, revision: number, mustBeEnabled = false) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE COALESCE((SELECT revision FROM group_mailing_sync_settings WHERE group_id = ?), 0) = ?
    ${mustBeEnabled ? "AND COALESCE((SELECT enabled FROM group_mailing_sync_settings WHERE group_id = ?), 1) = 1" : ""}`,
    bindings: [groupId, revision, ...(mustBeEnabled ? [groupId] : [])],
  });
}
function conflict(error: unknown): never {
  if (isAuthorizationGuardFailure(error))
    throw new AppError(
      409,
      "GROUP_SYNC_CHANGED",
      "Synchronization settings or your permission changed. Reload and retry.",
    );
  throw error;
}
export async function updateGroupMailingSyncSettings(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  input: z.infer<typeof groupMailingSyncUpdateSchema>,
) {
  await requireGroupManagement(db, actor, groupId);
  const now = nowIso();
  try {
    await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      revisionGuard(db, groupId, input.expectedRevision),
      db
        .prepare(
          `INSERT INTO group_mailing_sync_settings (group_id, enabled, revision, updated_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(group_id) DO UPDATE SET enabled = excluded.enabled, revision = group_mailing_sync_settings.revision + 1, updated_at = excluded.updated_at`,
        )
        .bind(groupId, input.enabled ? 1 : 0, now),
      prepareScopedAuditLog(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "group_mailing_sync_settings_updated",
        "group",
        groupId,
        { enabled: input.enabled },
        now,
      ),
    ]);
  } catch (error) {
    conflict(error);
  }
  if (input.enabled) await requestJobWake(db, "google_groups_sync");
  return getGroupMailingSyncSettings(db, actor, groupId);
}
export async function runGroupMailingSync(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  input: z.infer<typeof groupMailingSyncRunSchema>,
) {
  const settings = await getGroupMailingSyncSettings(db, actor, groupId);
  if (!settings.synchronization.enabled)
    throw new AppError(409, "GROUP_SYNC_PAUSED", "Enable synchronization before requesting a sync.");
  const now = nowIso();
  const requestId = uuid();
  let queued = 0;
  try {
    const result = await db.batch([
      prepareGroupManagementAuthorizationGuard(db, actor, [groupId]),
      revisionGuard(db, groupId, input.expectedRevision, true),
      prepareReconcileGroupMailingListSubscriptionsStatement(db, groupId, now),
      db
        .prepare(
          `INSERT INTO google_groups_sync_queue
        (id, user_id, action, google_group_email, idempotency_key, status, attempts, next_attempt_at, created_at)
        SELECT 'google-sync:' || lower(hex(randomblob(16))), desired.user_id, desired.desired_action, desired.google_group_email,
          'group-sync:' || ? || ':' || desired.user_id || ':' || desired.google_group_email, 'pending', 0, ?, ?
        FROM google_groups_membership_desired_state desired JOIN mailing_lists list ON list.email = desired.google_group_email
        WHERE list.group_id = ? AND NOT EXISTS (SELECT 1 FROM google_groups_sync_queue queue
          WHERE queue.user_id = desired.user_id AND queue.google_group_email = desired.google_group_email
            AND queue.generation = desired.generation AND queue.status IN ('pending', 'processing'))`,
        )
        .bind(requestId, now, now, groupId),
      db
        .prepare(
          `UPDATE google_groups_sync_queue SET next_attempt_at = ? WHERE status = 'pending'
        AND google_group_email IN (SELECT email FROM mailing_lists WHERE group_id = ?)`,
        )
        .bind(now, groupId),
      prepareScopedAuditLog(
        db,
        { type: "group", id: groupId },
        "admin",
        actor.id,
        "group_mailing_sync_requested",
        "group",
        groupId,
        { requestId },
        now,
      ),
    ]);
    queued = result[4].meta?.changes ?? 0;
  } catch (error) {
    conflict(error);
  }
  await requestJobWake(db, "google_groups_sync");
  return { queued };
}
