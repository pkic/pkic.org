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
import { queueEmail } from "../email/outbox";
import { closeDueVotes, resolveForumVoteDelegateRecipients } from "./votes";
import type { DatabaseLike, Env } from "../types";

export interface VotesDueWorkResult {
  opened: number;
  closed: number;
  roundsAdvanced: number;
  delegateNoticesQueued: number;
}

export async function runVotesDueWork(db: DatabaseLike, _env: Env): Promise<VotesDueWorkResult> {
  const result = await closeDueVotes(db);

  let delegateNoticesQueued = 0;
  for (const voteId of [...result.opened, ...result.roundsAdvanced]) {
    const resolved = await resolveForumVoteDelegateRecipients(db, voteId);
    if (!resolved) continue;

    for (const recipient of resolved.recipients) {
      // Enqueue only (PR #1 review §9.1) — no synchronous send per
      // recipient; the shared bounded outbox processor (run earlier in the
      // same registry pass by runScheduledDueWork) owns delivery/retry.
      await queueEmail(db, {
        templateKey: "forum-vote-delegate-notify",
        recipientEmail: recipient.delegateEmail,
        messageType: "transactional",
        subject: `Forum vote open: ${resolved.vote.title}`,
        data: {
          delegateName: recipient.delegateName,
          organizationName: recipient.organizationName,
          voteTitle: resolved.vote.title,
          closesAt: resolved.vote.closesAt,
          voteUrl: `/portal/votes/${resolved.vote.id}`,
        },
      });
      delegateNoticesQueued += 1;
    }
  }

  return {
    opened: result.opened.length,
    closed: result.closed.length,
    roundsAdvanced: result.roundsAdvanced.length,
    delegateNoticesQueued,
  };
}
