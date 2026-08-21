/**
 * Voting due-work: opens scheduled votes, closes/
 * advances open votes past closes_at, and emails each forum vote's
 * eligible delegates (`forum-vote-delegate-notify`) on initial open and on
 * every round advance. The router gives this lane its own cron invocation
 * and D1 statement budget, separate from registration, membership, and
 * sponsorship due-work. closeDueVotes is already bounded by its own LIMIT,
 * so no due-work-side change was needed for §9.1 here beyond the
 * enqueue-only fix below.
 */
import { prepareQueueEmailStatement } from "../email/outbox";
import { hasD1QueryCapacity, type D1QueryBudget } from "../db/query-budget";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import { closeDueVotes, listPendingForumVoteNotifications } from "./votes";
import type { DatabaseLike, Env, StatementLike } from "../types";

export interface VotesDueWorkResult {
  opened: number;
  closed: number;
  roundsAdvanced: number;
  delegateNoticesQueued: number;
}

export async function runVotesDueWork(
  db: DatabaseLike,
  env: Env,
  transitionLimit = 50,
  d1QueryBudget?: D1QueryBudget,
): Promise<VotesDueWorkResult> {
  const result = await closeDueVotes(db, transitionLimit, d1QueryBudget);
  const parsedNotificationLimit = Number.parseInt(env.SCHEDULED_VOTE_NOTIFICATION_LIMIT ?? "100", 10);
  const configuredNotificationLimit = Math.min(
    500,
    Math.max(0, Number.isFinite(parsedNotificationLimit) ? parsedNotificationLimit : 100),
  );
  const budgetNotificationLimit = d1QueryBudget
    ? Math.floor(Math.max(0, d1QueryBudget.remainingQueries() - 1) / 2)
    : configuredNotificationLimit;
  const notificationLimit = Math.min(configuredNotificationLimit, budgetNotificationLimit);
  if (notificationLimit < 1 || !hasD1QueryCapacity(d1QueryBudget, 1)) {
    return {
      opened: result.opened.length,
      closed: result.closed.length,
      roundsAdvanced: result.roundsAdvanced.length,
      delegateNoticesQueued: 0,
    };
  }
  const pending = await listPendingForumVoteNotifications(db, notificationLimit);
  const queuedAt = nowIso();
  const statements: StatementLike[] = [];
  const preparedRecipients = await Promise.all(
    pending.map(async (recipient) => {
      const operationKey = `forum-vote-delegate-notify:${recipient.voteId}:${recipient.round}:${recipient.organizationId}:${recipient.delegateUserId}`;
      return { recipient, operationKey, outboxId: (await sha256Hex(operationKey)).slice(0, 32) };
    }),
  );
  for (const { recipient, operationKey, outboxId } of preparedRecipients) {
    const email = prepareQueueEmailStatement(
      db,
      {
        outboxId,
        idempotencyKey: operationKey,
        templateKey: "forum-vote-delegate-notify",
        recipientUserId: recipient.delegateUserId,
        recipientEmail: recipient.delegateEmail,
        messageType: "transactional",
        subject: `Forum vote open: ${recipient.voteTitle}`,
        data: {
          delegateName: recipient.delegateName,
          organizationName: recipient.organizationName,
          voteTitle: recipient.voteTitle,
          closesAt: recipient.closesAt,
          voteUrl: `/portal/votes/${recipient.voteId}`,
        },
      },
      queuedAt,
    );
    statements.push(
      email.statement,
      db
        .prepare(
          `INSERT OR IGNORE INTO vote_notification_deliveries
             (vote_id, round, organization_id, delegate_user_id, queued_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(recipient.voteId, recipient.round, recipient.organizationId, recipient.delegateUserId, queuedAt),
    );
  }
  if (statements.length > 0) await db.batch(statements);

  return {
    opened: result.opened.length,
    closed: result.closed.length,
    roundsAdvanced: result.roundsAdvanced.length,
    delegateNoticesQueued: pending.length,
  };
}
