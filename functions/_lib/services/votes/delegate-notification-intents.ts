import { all } from "../../db/queries";
import { chunkJsonRows } from "../../db/json-bulk";
import type { DatabaseLike, StatementLike } from "../../types";
import { REPRESENTATIVE_ROLE_IDS } from "../membership/representative-roles";

/**
 * Immutable event-time recipient snapshot for one member organization and
 * vote round. The vote may close or advance before this intent is drained.
 */
export interface PendingForumVoteNotificationIntent {
  voteId: string;
  voteTitle: string;
  round: number;
  closesAt: string;
  organizationId: string;
  organizationName: string;
  delegateUserId: string;
  delegateEmail: string;
  delegateName: string;
}

/**
 * Snapshots all eligible forum delegates in one set-based statement. Callers
 * place this after the guarded write and its changes()-based audit statement
 * in the same D1 batch, making the notification intent part of the state
 * transition rather than a later inference from mutable vote state.
 */
export function prepareForumVoteDelegateNotificationIntents(
  db: DatabaseLike,
  voteId: string,
  round: number,
  createdAt: string,
): StatementLike {
  return db
    .prepare(
      `WITH target_vote AS (
         SELECT id, title, closes_at, eligible_categories
         FROM votes
         WHERE id = ?
           AND scope_type = 'forum'
           AND status = 'open'
           AND current_round = ?
       )
       INSERT INTO vote_delegate_notification_intents (
         vote_id, round, organization_id, delegate_user_id, recipient_email,
         delegate_name, organization_name, vote_title, closes_at, created_at,
         queued_outbox_id, queued_at
       )
       SELECT
         v.id, ?, o.id, COALESCE(vdu.id, pcu.id), COALESCE(vdu.email, pcu.email),
         CASE
           WHEN TRIM(
             COALESCE(vdu.first_name, pcu.first_name, '') || ' ' ||
             COALESCE(vdu.last_name, pcu.last_name, '')
           ) <> ''
           THEN TRIM(
             COALESCE(vdu.first_name, pcu.first_name, '') || ' ' ||
             COALESCE(vdu.last_name, pcu.last_name, '')
           )
           ELSE COALESCE(vdu.email, pcu.email)
         END,
         o.name, v.title, v.closes_at, ?, NULL, NULL
       FROM target_vote v
       JOIN members m ON m.status = 'active' AND m.organization_id IS NOT NULL
       JOIN organizations o ON o.id = m.organization_id
       JOIN member_category_assignments mca ON mca.member_id = m.id
       LEFT JOIN user_roles vd
         ON vd.context_type = 'organization'
        AND vd.context_id = m.id
        AND vd.role_id = ?
        AND vd.revoked_at IS NULL
        AND (vd.expires_at IS NULL OR datetime(vd.expires_at) > datetime(?))
       LEFT JOIN organization_representatives vd_rep
         ON vd_rep.member_id = m.id AND vd_rep.user_id = vd.user_id AND vd_rep.left_at IS NULL
       LEFT JOIN users vdu ON vdu.id = vd.user_id AND vdu.active = 1 AND vd_rep.id IS NOT NULL
       LEFT JOIN user_roles pc
         ON pc.context_type = 'organization'
        AND pc.context_id = m.id
        AND pc.role_id = ?
        AND pc.revoked_at IS NULL
        AND (pc.expires_at IS NULL OR datetime(pc.expires_at) > datetime(?))
       LEFT JOIN organization_representatives pc_rep
         ON pc_rep.member_id = m.id AND pc_rep.user_id = pc.user_id AND pc_rep.left_at IS NULL
       LEFT JOIN users pcu ON pcu.id = pc.user_id AND pcu.active = 1 AND pc_rep.id IS NOT NULL
       WHERE COALESCE(vdu.id, pcu.id) IS NOT NULL
         AND (
           v.eligible_categories IS NULL
           OR EXISTS (
             SELECT 1
             FROM json_each(v.eligible_categories) category
             WHERE category.value = mca.category_code
           )
         )
       ON CONFLICT(vote_id, round, organization_id) DO NOTHING`,
    )
    .bind(
      voteId,
      round,
      round,
      createdAt,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
      createdAt,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      createdAt,
    );
}

/** A bounded, indexed backlog independent of the vote's current state. */
export async function listPendingForumVoteNotificationIntents(
  db: DatabaseLike,
  limit: number,
): Promise<PendingForumVoteNotificationIntent[]> {
  const rows = await all<{
    vote_id: string;
    vote_title: string;
    round: number;
    closes_at: string;
    organization_id: string;
    organization_name: string;
    delegate_user_id: string;
    recipient_email: string;
    delegate_name: string;
  }>(
    db,
    `SELECT vote_id, vote_title, round, closes_at, organization_id,
            organization_name, delegate_user_id, recipient_email, delegate_name
     FROM vote_delegate_notification_intents
     WHERE queued_outbox_id IS NULL
     ORDER BY created_at ASC, vote_id ASC, round ASC, organization_id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    voteId: row.vote_id,
    voteTitle: row.vote_title,
    round: row.round,
    closesAt: row.closes_at,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    delegateUserId: row.delegate_user_id,
    delegateEmail: row.recipient_email,
    delegateName: row.delegate_name,
  }));
}

export interface PreparedVoteNotificationDelivery {
  voteId: string;
  round: number;
  organizationId: string;
  outboxId: string;
  idempotencyKey: string;
}

/**
 * Marks queued intents in bounded JSON chunks, but only when the matching
 * idempotent email outbox row exists in the same D1 transaction.
 */
export function prepareMarkVoteNotificationIntentsQueued(
  db: DatabaseLike,
  deliveries: PreparedVoteNotificationDelivery[],
  queuedAt: string,
): StatementLike[] {
  return chunkJsonRows(deliveries).map((chunk) =>
    db
      .prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.voteId') AS vote_id,
             json_extract(value, '$.round') AS round,
             json_extract(value, '$.organizationId') AS organization_id,
             json_extract(value, '$.outboxId') AS outbox_id,
             json_extract(value, '$.idempotencyKey') AS idempotency_key
           FROM json_each(?)
         )
         UPDATE vote_delegate_notification_intents
         SET queued_outbox_id = (
               SELECT input.outbox_id
               FROM input
               WHERE input.vote_id = vote_delegate_notification_intents.vote_id
                 AND input.round = vote_delegate_notification_intents.round
                 AND input.organization_id = vote_delegate_notification_intents.organization_id
             ),
             queued_at = ?
         WHERE queued_outbox_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM input
             JOIN email_outbox e
               ON e.id = input.outbox_id
              AND e.idempotency_key = input.idempotency_key
             WHERE input.vote_id = vote_delegate_notification_intents.vote_id
               AND input.round = vote_delegate_notification_intents.round
               AND input.organization_id = vote_delegate_notification_intents.organization_id
           )`,
      )
      .bind(chunk.json, queuedAt),
  );
}
