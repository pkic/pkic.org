/**
 * Voting due-work: opens scheduled votes, closes/
 * advances open votes past closes_at, and emails each forum vote's
 * eligible delegates (`forum-vote-delegate-notify`) on initial open and on
 * every round advance. Dispatched as one job in the shared registry
 * (scheduled-jobs/registry.ts) that functions/router.ts's REMINDER_CRON
 * entrypoint runs alongside runScheduledDueWork, membership-scheduled-
 * jobs.ts's runMembershipDueWork, and sponsorship-scheduled-jobs.ts's
 * runSponsorshipDueWork — not woven into runScheduledDueWork's own
 * multi-pass budgeted loop, for the same "keep this phase's additions
 * isolated" reason documented there. closeDueVotes is already bounded by
 * its own LIMIT, so no due-work-side change was needed for §9.1 here beyond
 * the enqueue-only fix below.
 */
import { prepareQueueEmailStatement } from "../email/outbox";
import { nowIso } from "../utils/time";
import { closeDueVotes, listPendingForumVoteNotifications } from "./votes";
import type { DatabaseLike, Env } from "../types";

export interface VotesDueWorkResult {
  opened: number;
  closed: number;
  roundsAdvanced: number;
  delegateNoticesQueued: number;
}

export async function runVotesDueWork(db: DatabaseLike, env: Env): Promise<VotesDueWorkResult> {
  const result = await closeDueVotes(db);
  const notificationLimit = Math.max(1, Number.parseInt(env.SCHEDULED_VOTE_NOTIFICATION_LIMIT ?? "100", 10) || 100);
  const pending = await listPendingForumVoteNotifications(db, notificationLimit);
  const queuedAt = nowIso();
  const statements = pending.flatMap((recipient) => {
    const email = prepareQueueEmailStatement(
      db,
      {
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
    return [
      email.statement,
      db
        .prepare(
          `INSERT INTO vote_notification_deliveries
             (vote_id, round, organization_id, delegate_user_id, queued_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(recipient.voteId, recipient.round, recipient.organizationId, recipient.delegateUserId, queuedAt),
    ];
  });
  if (statements.length > 0) await db.batch(statements);

  return {
    opened: result.opened.length,
    closed: result.closed.length,
    roundsAdvanced: result.roundsAdvanced.length,
    delegateNoticesQueued: pending.length,
  };
}
