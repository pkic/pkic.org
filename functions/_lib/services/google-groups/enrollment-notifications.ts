import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { all } from "../../db/queries";
import { chunkJsonRows } from "../../db/json-bulk";
import { prepareBulkQueueEmailChunkStatements, type BulkEmailQueueRow } from "../../email/outbox";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";

const COMPLETED_ENROLLMENT_INTENT_SQL = `EXISTS (
  SELECT 1 FROM google_groups_sync_queue source
  JOIN google_groups_membership_desired_state target ON target.user_id=source.user_id
    AND target.google_group_email=source.google_group_email AND target.desired_action != 'remove_from_list'
  WHERE source.id=intent.queue_id AND source.status='completed'
)`;
function pendingUserAddsSql(userId: string) {
  return `EXISTS (
    SELECT 1 FROM google_groups_membership_desired_state desired
    JOIN google_groups_sync_queue queue ON queue.user_id=desired.user_id
      AND queue.google_group_email=desired.google_group_email AND queue.generation=desired.generation
    WHERE desired.user_id=${userId} AND desired.desired_action='add_to_list'
      AND queue.status IN ('pending','processing')
  )`;
}

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
  // A person's initial adds may span several bounded queue passes. Wait until
  // their current add work settles, then select their entire unsent group.
  const rows = await all<PendingGoogleGroupsEnrollmentIntent>(
    db,
    `WITH eligible_intents AS (
      SELECT intent.queue_id AS queueId, intent.user_id AS userId, intent.sync_pass_id AS syncPassId,
        intent.google_group_email AS googleGroupEmail, person.email AS recipientEmail,
        COALESCE(NULLIF(trim(COALESCE(person.first_name,'') || ' ' || COALESCE(person.last_name,'')),''),person.email) AS memberName, intent.created_at
      FROM google_groups_enrollment_notification_intents intent
      JOIN users person ON person.id=intent.user_id AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
      WHERE intent.queued_outbox_id IS NULL AND ${COMPLETED_ENROLLMENT_INTENT_SQL}
        AND NOT ${pendingUserAddsSql("intent.user_id")}
    ), recipients AS (
      SELECT userId FROM eligible_intents GROUP BY userId ORDER BY MIN(created_at),userId LIMIT ?
    ) SELECT queueId,userId,syncPassId,googleGroupEmail,recipientEmail,memberName FROM eligible_intents
      WHERE userId IN (SELECT userId FROM recipients) ORDER BY userId,created_at,queueId LIMIT 10001`,
    [limit],
  );
  if (rows.length > 10000) throw new Error("Enrollment notifications exceed the bounded drain limit");
  return rows;
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
                queued_at = ?, recipient_email = '', member_name = ''
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
    const groupKey = intent.userId;
    const group = groups.get(groupKey) ?? [];
    group.push(intent);
    groups.set(groupKey, group);
  }

  const prepared = await Promise.all(
    [...groups.values()].map(async (intents) => {
      const { userId } = intents[0];
      const cohort = await sha256Hex(JSON.stringify(intents.map((intent) => intent.queueId).sort()));
      const idempotencyKey = `google-groups:enrollment:${userId}:${cohort}`;
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
            // Same-millisecond inserts can be returned in a different row
            // order by SQLite. Keep the email payload and idempotent retries
            // deterministic instead of depending on UUID/row traversal order.
            lists: [...new Set(intents.map((intent) => intent.googleGroupEmail))].sort(),
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

  // Refuse a stale recipient snapshot if another completion/drain changed its
  // unsent cohort or new current add work arrived before this atomic command.
  const guards = prepared.map(({ intents }) => {
    const queueIds = JSON.stringify(intents.map((intent) => intent.queueId));
    return prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE NOT EXISTS (
        SELECT 1 FROM google_groups_enrollment_notification_intents intent
        WHERE intent.user_id=? AND intent.queued_outbox_id IS NULL
          AND ${COMPLETED_ENROLLMENT_INTENT_SQL}
          AND intent.queue_id NOT IN (SELECT value FROM json_each(?))
      ) AND (SELECT COUNT(*) FROM google_groups_enrollment_notification_intents intent
        WHERE intent.queue_id IN (SELECT value FROM json_each(?)) AND intent.queued_outbox_id IS NULL
          AND ${COMPLETED_ENROLLMENT_INTENT_SQL}) = json_array_length(?)
      AND EXISTS (SELECT 1 FROM users person WHERE person.id=? AND person.email=? AND person.active=1
        AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL)
      AND NOT ${pendingUserAddsSql("?")}`,
      bindings: [
        intents[0].userId,
        queueIds,
        queueIds,
        queueIds,
        intents[0].userId,
        intents[0].recipientEmail,
        intents[0].userId,
      ],
    });
  });
  let results;
  try {
    results = await db.batch([...guards, ...emailStatements, ...markStatements]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return 0;
    throw error;
  }
  return results
    .slice(guards.length + emailStatements.length)
    .reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}
