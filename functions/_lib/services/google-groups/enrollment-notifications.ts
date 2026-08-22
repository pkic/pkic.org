import { all } from "../../db/queries";
import { chunkJsonRows } from "../../db/json-bulk";
import { prepareBulkQueueEmailChunkStatements, type BulkEmailQueueRow } from "../../email/outbox";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";

export interface PendingGoogleGroupsEnrollmentIntent {
  queueId: string;
  userId: string;
  syncPassId: string;
  googleGroupEmail: string;
  recipientEmail: string;
  memberName: string;
}

export async function listPendingGoogleGroupsEnrollmentIntents(
  db: DatabaseLike,
  limit: number,
): Promise<PendingGoogleGroupsEnrollmentIntent[]> {
  // LIMIT bounds complete (sync pass, recipient) groups, not rows, so one
  // recipient's pending lists from one pass are never split at the page
  // boundary. A later pass for the same recipient remains a separate email,
  // matching the original per-pass grouping semantics.
  return all<PendingGoogleGroupsEnrollmentIntent>(
    db,
    `SELECT queue_id AS queueId, user_id AS userId, sync_pass_id AS syncPassId,
            google_group_email AS googleGroupEmail,
            recipient_email AS recipientEmail, member_name AS memberName
       FROM google_groups_enrollment_notification_intents
      WHERE queued_outbox_id IS NULL
        AND EXISTS (
          SELECT 1
            FROM (
              SELECT sync_pass_id, user_id
                FROM google_groups_enrollment_notification_intents
               WHERE queued_outbox_id IS NULL
               GROUP BY sync_pass_id, user_id
               ORDER BY MIN(created_at) ASC, sync_pass_id ASC, user_id ASC
               LIMIT ?
            ) selected_groups
           WHERE selected_groups.sync_pass_id = google_groups_enrollment_notification_intents.sync_pass_id
             AND selected_groups.user_id = google_groups_enrollment_notification_intents.user_id
        )
      ORDER BY sync_pass_id ASC, user_id ASC, created_at ASC, queue_id ASC`,
    [limit],
  );
}

function buildMarkQueuedStatements(
  db: DatabaseLike,
  deliveries: Array<{ queueId: string; outboxId: string; idempotencyKey: string }>,
  queuedAt: string,
): StatementLike[] {
  return chunkJsonRows(deliveries).map((chunk) =>
    db
      .prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.queueId') AS queue_id,
             json_extract(value, '$.outboxId') AS outbox_id,
             json_extract(value, '$.idempotencyKey') AS idempotency_key
           FROM json_each(?)
         )
         UPDATE google_groups_enrollment_notification_intents
            SET queued_outbox_id = (
                  SELECT input.outbox_id
                    FROM input
                   WHERE input.queue_id = google_groups_enrollment_notification_intents.queue_id
                ),
                queued_at = ?
          WHERE queued_outbox_id IS NULL
            AND EXISTS (
              SELECT 1
                FROM input
                JOIN email_outbox outbox
                  ON outbox.id = input.outbox_id
                 AND outbox.idempotency_key = input.idempotency_key
               WHERE input.queue_id = google_groups_enrollment_notification_intents.queue_id
            )`,
      )
      .bind(chunk.json, queuedAt),
  );
}

/**
 * Drains durable enrollment intents into one grouped email per recipient.
 * The outbox insert and intent markers commit together; a concurrent retry
 * reuses the same deterministic key for the same selected intent set.
 */
export async function drainGoogleGroupsEnrollmentNotificationIntents(db: DatabaseLike, limit: number): Promise<number> {
  const pending = await listPendingGoogleGroupsEnrollmentIntents(db, limit);
  if (pending.length === 0) return 0;

  const groups = new Map<string, PendingGoogleGroupsEnrollmentIntent[]>();
  for (const intent of pending) {
    const groupKey = `${intent.syncPassId}\u0000${intent.userId}`;
    const group = groups.get(groupKey) ?? [];
    group.push(intent);
    groups.set(groupKey, group);
  }

  const prepared = await Promise.all(
    [...groups.values()].map(async (intents) => {
      const { syncPassId, userId } = intents[0];
      const idempotencyKey = `google-groups:enrollment:${syncPassId}:${userId}`;
      const outboxId = (await sha256Hex(idempotencyKey)).slice(0, 32);
      return {
        intents,
        outboxId,
        idempotencyKey,
        row: {
          outboxId,
          idempotencyKey,
          templateKey: "mailing-list-enrolled",
          recipientUserId: userId,
          recipientEmail: intents[0].recipientEmail,
          subject: "You have been added to PKI Consortium mailing lists",
          messageType: "transactional" as const,
          data: {
            memberName: intents[0].memberName,
            lists: intents.map((intent) => intent.googleGroupEmail),
          },
        } satisfies BulkEmailQueueRow,
      };
    }),
  );

  const queuedAt = nowIso();
  const emailStatements = prepareBulkQueueEmailChunkStatements(
    db,
    prepared.map((item) => item.row),
    queuedAt,
  ).map((chunk) => chunk.statement);
  const deliveries = prepared.flatMap((item) =>
    item.intents.map((intent) => ({
      queueId: intent.queueId,
      outboxId: item.outboxId,
      idempotencyKey: item.idempotencyKey,
    })),
  );
  const markStatements = buildMarkQueuedStatements(db, deliveries, queuedAt);
  if (emailStatements.length + markStatements.length === 0) return 0;

  const results = await db.batch([...emailStatements, ...markStatements]);
  return results.slice(emailStatements.length).reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}
