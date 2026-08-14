/**
 * Voting due-work: opens scheduled votes, closes/
 * advances open votes past closes_at, and emails each forum vote's
 * eligible delegates (`forum-vote-delegate-notify`) on initial open and on
 * every round advance. Folded into the existing 15-minute due-work cron
 * (functions/router.ts) as a sibling call, same as
 * membership-scheduled-jobs.ts's runMembershipDueWork and
 * sponsorship-scheduled-jobs.ts's runSponsorshipDueWork — not woven into
 * scheduled-due-work.ts's own multi-pass budgeted loop, for the same "keep
 * this phase's additions isolated" reason documented there.
 */
import { queueEmail, processOutboxByIdBackground } from "../email/outbox";
import { closeDueVotes, resolveForumVoteDelegateRecipients } from "./votes";
import type { DatabaseLike, Env } from "../types";

export interface VotesDueWorkResult {
  opened: number;
  closed: number;
  roundsAdvanced: number;
  delegateNoticesQueued: number;
}

export async function runVotesDueWork(db: DatabaseLike, env: Env): Promise<VotesDueWorkResult> {
  const result = await closeDueVotes(db);

  let delegateNoticesQueued = 0;
  for (const voteId of [...result.opened, ...result.roundsAdvanced]) {
    const resolved = await resolveForumVoteDelegateRecipients(db, voteId);
    if (!resolved) continue;

    for (const recipient of resolved.recipients) {
      const outboxId = await queueEmail(db, {
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
      await processOutboxByIdBackground(db, env, outboxId);
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
