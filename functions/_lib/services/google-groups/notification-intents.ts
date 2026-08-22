import { first } from "../../db/queries";
import { prepareQueueEmailStatementWhen, type QueueEmailPayload } from "../../email/outbox";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import type { DatabaseLike, StatementLike } from "../../types";
import { resolveWgJoinCalendarInviteByMailingListEmail } from "../meeting-calendar/triggers";
import { buildWgCalendarInviteEmail } from "../membership/notifications";
import type { ClaimedGoogleGroupsSyncRow } from "./contracts";

const CURRENT_ADD_STATE_CONDITION = `
  SELECT 1
    FROM google_groups_sync_queue queue
    JOIN google_groups_membership_desired_state desired
      ON desired.user_id = queue.user_id
     AND desired.google_group_email = queue.google_group_email
     AND desired.generation = queue.generation
     AND desired.desired_action = queue.action
   WHERE queue.id = ?
     AND queue.status = 'completed'
     AND queue.action = 'add_to_list'`;

async function deterministicOutboxIdentity(
  operationKey: string,
): Promise<{ outboxId: string; idempotencyKey: string }> {
  return { outboxId: (await sha256Hex(operationKey)).slice(0, 32), idempotencyKey: operationKey };
}

function withIdempotency(
  draft: QueueEmailPayload,
  identity: { outboxId: string; idempotencyKey: string },
): QueueEmailPayload {
  return { ...draft, outboxId: identity.outboxId, idempotencyKey: identity.idempotencyKey };
}

/**
 * Builds notification inserts for one successful add. The returned
 * statements must be committed in the same D1 batch as queue completion. The
 * enrollment intent is one row per queue item so the later drain can preserve
 * the existing one-email-per-user grouping; calendar delivery remains one
 * deterministic outbox row per working group.
 */
export async function prepareGoogleGroupsSyncNotificationStatements(
  db: DatabaseLike,
  claim: ClaimedGoogleGroupsSyncRow,
  memberEmail: string,
  syncPassId: string,
): Promise<StatementLike[]> {
  if (claim.action !== "add_to_list") return [];

  const user = await first<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    "SELECT email, first_name, last_name FROM users WHERE id = ?",
    [claim.user_id],
  );
  if (!user) throw new Error("User disappeared while preparing Google Groups notification intents");

  const memberName = [user.first_name, user.last_name].filter(Boolean).join(" ") || memberEmail;
  const condition = { sql: CURRENT_ADD_STATE_CONDITION, bindings: [claim.id] };
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO google_groups_enrollment_notification_intents
           (queue_id, user_id, sync_pass_id, google_group_email, recipient_email, member_name, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${CURRENT_ADD_STATE_CONDITION})
         ON CONFLICT(queue_id) DO NOTHING`,
      )
      .bind(claim.id, claim.user_id, syncPassId, claim.google_group_email, user.email, memberName, nowIso(), claim.id),
  ];

  const invite = await resolveWgJoinCalendarInviteByMailingListEmail(db, claim.google_group_email);
  if (!invite) return statements;

  const calendarIdentity = await deterministicOutboxIdentity(`google-groups:calendar:${claim.id}`);
  statements.push(
    prepareQueueEmailStatementWhen(
      db,
      withIdempotency(
        buildWgCalendarInviteEmail({
          recipientEmail: user.email,
          memberName,
          workingGroupName: invite.workingGroupName,
          attachments: invite.attachments,
        }),
        calendarIdentity,
      ),
      condition,
    ).statement,
  );
  return statements;
}
