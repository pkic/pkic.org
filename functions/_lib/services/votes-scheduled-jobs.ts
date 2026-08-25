/**
 * Voting due-work: opens scheduled votes, closes/
 * advances open votes past closes_at, and emails every eligible Member
 * representative (`member-vote-representative-notify`) on initial open and on
 * every round advance. The router gives this lane its own cron invocation
 * and D1 statement budget, separate from registration, membership, and
 * sponsorship due-work. closeDueVotes is already bounded by its own LIMIT,
 * so no due-work-side change was needed for §9.1 here beyond the
 * enqueue-only fix below.
 */
import { prepareBulkQueueEmailChunkStatements, type BulkEmailQueueRow } from "../email/outbox";
import { hasD1QueryCapacity, type D1QueryBudget } from "../db/query-budget";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import {
  closeDueVotes,
  listPendingVoteRepresentativeNotificationIntents,
  prepareMarkVoteNotificationIntentsQueued,
  type PreparedVoteNotificationDelivery,
} from "./votes";
import type { DatabaseLike, Env } from "../types";

export interface VotesDueWorkResult {
  opened: number;
  closed: number;
  roundsAdvanced: number;
  representativeNoticesQueued: number;
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
      representativeNoticesQueued: 0,
    };
  }
  const pending = await listPendingVoteRepresentativeNotificationIntents(db, notificationLimit);
  const queuedAt = nowIso();
  const preparedRecipients = await Promise.all(
    pending.map(async (recipient) => {
      const operationKey = `member-vote-representative-notify:${recipient.voteId}:${recipient.round}:${recipient.memberId}:${recipient.representativeUserId}`;
      return { recipient, operationKey, outboxId: (await sha256Hex(operationKey)).slice(0, 32) };
    }),
  );
  const emailRows: BulkEmailQueueRow[] = preparedRecipients.map(({ recipient, operationKey, outboxId }) => ({
    outboxId,
    idempotencyKey: operationKey,
    templateKey: "member-vote-representative-notify",
    recipientUserId: recipient.representativeUserId,
    recipientEmail: recipient.representativeEmail,
    messageType: "transactional",
    subject: `Vote open: ${recipient.voteTitle}`,
    data: {
      representativeName: recipient.representativeName,
      organizationName: recipient.organizationName,
      voteTitle: recipient.voteTitle,
      closesAt: recipient.closesAt,
      voteUrl: `/portal/votes/${recipient.voteId}`,
    },
    requiredVoteNotification: {
      voteId: recipient.voteId,
      round: recipient.round,
      memberId: recipient.memberId,
      representativeUserId: recipient.representativeUserId,
    },
  }));
  const deliveries: PreparedVoteNotificationDelivery[] = preparedRecipients.map(
    ({ recipient, operationKey, outboxId }) => ({
      voteId: recipient.voteId,
      round: recipient.round,
      memberId: recipient.memberId,
      representativeUserId: recipient.representativeUserId,
      outboxId,
      idempotencyKey: operationKey,
    }),
  );
  const emailStatements = prepareBulkQueueEmailChunkStatements(db, emailRows, queuedAt).map((chunk) => chunk.statement);
  const markStatements = prepareMarkVoteNotificationIntentsQueued(db, deliveries, queuedAt);
  let representativeNoticesQueued = 0;
  if (emailStatements.length + markStatements.length > 0) {
    const batchResults = await db.batch([...emailStatements, ...markStatements]);
    representativeNoticesQueued = batchResults
      .slice(emailStatements.length)
      .reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  }

  return {
    opened: result.opened.length,
    closed: result.closed.length,
    roundsAdvanced: result.roundsAdvanced.length,
    representativeNoticesQueued,
  };
}
