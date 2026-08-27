/** Durable notification-intent snapshots for current vote representatives. */
import { all } from "../../db/queries";
import { chunkJsonRows } from "../../db/json-bulk";
import type { DatabaseLike, StatementLike } from "../../types";
import { votingMembershipCategoryExistsSql } from "../membership/categories";
import { voteParticipationGroupPredicate } from "./vote-access";

/**
 * Immutable event-time recipient snapshot for one member organization and
 * vote round. The vote may close or advance before this intent is drained.
 */
export interface PendingVoteRepresentativeNotificationIntent {
  voteId: string;
  voteTitle: string;
  round: number;
  closesAt: string;
  memberId: string;
  organizationName: string;
  representativeUserId: string;
  representativeEmail: string;
  representativeName: string;
}

/**
 * Snapshots every current representative of every eligible Member capacity in
 * the vote's owning group. All representatives are equal for voting; a later
 * valid ballot replaces the Member's earlier ballot for that round. Callers
 * place this after the guarded write and its changes()-based audit statement
 * in the same D1 batch, making the notification intent part of the state
 * transition rather than a later inference from mutable vote state.
 */
export function prepareVoteRepresentativeNotificationIntents(
  db: DatabaseLike,
  voteId: string,
  round: number,
  createdAt: string,
): StatementLike {
  return db
    .prepare(
      `WITH target_vote AS (
         SELECT id, title, closes_at, eligible_categories, owner_group_id
         FROM votes
         WHERE id = ?
           AND electorate_mode = 'per_member'
           AND status = 'open'
           AND current_round = ?
       )
       INSERT INTO vote_representative_notification_intents (
         vote_id, round, member_id, representative_user_id, recipient_email,
         representative_name, organization_name, vote_title, closes_at, created_at,
         queued_outbox_id, queued_at
       )
       SELECT
         v.id, ?, membership.member_id, representative.user_id, representative_user.email,
         CASE
           WHEN TRIM(
             COALESCE(representative_user.first_name, '') || ' ' ||
             COALESCE(representative_user.last_name, '')
           ) <> ''
           THEN TRIM(
             COALESCE(representative_user.first_name, '') || ' ' ||
             COALESCE(representative_user.last_name, '')
           )
           ELSE representative_user.email
         END,
         o.name, v.title, v.closes_at, ?, NULL, NULL
       FROM target_vote v
       JOIN group_memberships membership
         ON membership.left_at IS NULL
        AND ${voteParticipationGroupPredicate("v", "membership.group_id")}
       JOIN members m ON m.id = membership.member_id AND m.status = 'active' AND m.organization_id IS NOT NULL
       JOIN organizations o ON o.id = m.organization_id
       JOIN member_category_assignments mca ON mca.member_id = m.id
       JOIN organization_representatives representative
         ON representative.member_id = m.id
        AND representative.user_id = membership.user_id
        AND representative.left_at IS NULL
        AND representative.blocked_at IS NULL
       JOIN users representative_user
         ON representative_user.id = representative.user_id
        AND representative_user.active = 1
       WHERE (
           ${votingMembershipCategoryExistsSql("mca.category_code")}
         ) AND (
           v.eligible_categories IS NULL
           OR EXISTS (
             SELECT 1
             FROM json_each(v.eligible_categories) category
             WHERE category.value = mca.category_code
           )
         )
       ON CONFLICT(vote_id, round, member_id, representative_user_id) DO NOTHING`,
    )
    .bind(voteId, round, round, createdAt);
}

/** A bounded, indexed backlog independent of the vote's current state. */
export async function listPendingVoteRepresentativeNotificationIntents(
  db: DatabaseLike,
  limit: number,
): Promise<PendingVoteRepresentativeNotificationIntent[]> {
  const rows = await all<{
    vote_id: string;
    vote_title: string;
    round: number;
    closes_at: string;
    member_id: string;
    organization_name: string;
    representative_user_id: string;
    recipient_email: string;
    representative_name: string;
  }>(
    db,
    `SELECT vote_id, vote_title, round, closes_at, member_id,
            organization_name, representative_user_id, recipient_email, representative_name
     FROM vote_representative_notification_intents
     WHERE queued_outbox_id IS NULL
     ORDER BY created_at ASC, vote_id ASC, round ASC, member_id ASC, representative_user_id ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    voteId: row.vote_id,
    voteTitle: row.vote_title,
    round: row.round,
    closesAt: row.closes_at,
    memberId: row.member_id,
    organizationName: row.organization_name,
    representativeUserId: row.representative_user_id,
    representativeEmail: row.recipient_email,
    representativeName: row.representative_name,
  }));
}

export interface PreparedVoteNotificationDelivery {
  voteId: string;
  round: number;
  memberId: string;
  representativeUserId: string;
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
             json_extract(value, '$.memberId') AS member_id,
             json_extract(value, '$.representativeUserId') AS representative_user_id,
             json_extract(value, '$.outboxId') AS outbox_id,
             json_extract(value, '$.idempotencyKey') AS idempotency_key
           FROM json_each(?)
         )
         UPDATE vote_representative_notification_intents
         SET queued_outbox_id = (
               SELECT input.outbox_id
               FROM input
               WHERE input.vote_id = vote_representative_notification_intents.vote_id
                 AND input.round = vote_representative_notification_intents.round
                 AND input.member_id = vote_representative_notification_intents.member_id
                 AND input.representative_user_id = vote_representative_notification_intents.representative_user_id
             ),
             queued_at = ?
         WHERE queued_outbox_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM input
             JOIN email_outbox e
               ON e.id = input.outbox_id
              AND e.idempotency_key = input.idempotency_key
             WHERE input.vote_id = vote_representative_notification_intents.vote_id
               AND input.round = vote_representative_notification_intents.round
               AND input.member_id = vote_representative_notification_intents.member_id
               AND input.representative_user_id = vote_representative_notification_intents.representative_user_id
           )`,
      )
      .bind(chunk.json, queuedAt),
  );
}
