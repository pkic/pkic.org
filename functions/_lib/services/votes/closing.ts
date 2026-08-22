/**
 * Bounded orchestration for automatic vote opening and closing.
 *
 * Closing claims a due vote before tallying. Ballot writes require the claim
 * to be absent, so accepted ballots cannot arrive after the tally snapshot.
 * A failed worker leaves an expiring lease for a later invocation to reclaim.
 */
import { all } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { claimDueVote, closeClaimedVote, openDueVote } from "./automatic-transitions";
import { VOTE_CLOSE_DUE_QUERY, VOTE_OPEN_DUE_QUERY } from "./due-queries";
import type { VoteRow } from "./shared";

export {
  VOTE_CLOSE_DUE_QUERY,
  VOTE_ELECTION_TALLY_QUERY,
  VOTE_MOTION_TALLY_QUERY,
  VOTE_OPEN_DUE_QUERY,
  VOTE_STANDING_CANDIDATES_QUERY,
} from "./due-queries";

export interface CloseDueVotesResult {
  opened: string[];
  closed: string[];
  roundsAdvanced: string[];
}

const VOTE_DUE_SELECTION_STATEMENTS = 2;
const VOTE_MIN_CLOSE_STATEMENTS = 4;
const VOTE_MAX_CLOSE_STATEMENTS = 7;
const VOTE_OPEN_STATEMENTS = 3;
const MAX_DUE_VOTES_PER_PASS = 250;

/**
 * Opens scheduled votes and then claims/finalizes due open votes. The limit
 * is a total transition limit across both lanes, not a per-lane multiplier.
 */
export async function closeDueVotes(
  db: DatabaseLike,
  limit = 50,
  d1QueryBudget?: D1QueryBudget,
): Promise<CloseDueVotesResult> {
  const result: CloseDueVotesResult = { opened: [], closed: [], roundsAdvanced: [] };
  const requestedLimit = Math.max(0, Math.min(MAX_DUE_VOTES_PER_PASS, Math.floor(limit)));
  if (requestedLimit === 0) return result;

  const budgetActionLimit = d1QueryBudget
    ? Math.floor(
        Math.max(0, d1QueryBudget.remainingQueries() - VOTE_DUE_SELECTION_STATEMENTS) / VOTE_MIN_CLOSE_STATEMENTS,
      )
    : requestedLimit;
  const actionLimit = Math.min(requestedLimit, budgetActionLimit);
  if (actionLimit < 1) return result;

  const now = nowIso();
  // With only one action, prioritize an already-open vote. Normal budgets
  // allow both lanes; this prevents close starvation under emergency limits.
  const openLimit = actionLimit === 1 ? 0 : Math.ceil(actionLimit / 2);
  let openCandidatesProcessed = 0;
  if (openLimit > 0 && hasD1QueryCapacity(d1QueryBudget, 1)) {
    const toOpen = await all<VoteRow>(db, VOTE_OPEN_DUE_QUERY, [now, openLimit]);
    for (const vote of toOpen) {
      if (!hasD1QueryCapacity(d1QueryBudget, VOTE_OPEN_STATEMENTS)) break;
      openCandidatesProcessed += 1;
      if (await openDueVote(db, vote, now)) result.opened.push(vote.id);
    }
  }

  const remainingActionLimit = actionLimit - openCandidatesProcessed;
  if (remainingActionLimit < 1 || !hasD1QueryCapacity(d1QueryBudget, 1 + VOTE_MIN_CLOSE_STATEMENTS)) {
    return result;
  }
  const budgetCloseLimit = d1QueryBudget
    ? Math.floor(Math.max(0, d1QueryBudget.remainingQueries() - 1) / VOTE_MIN_CLOSE_STATEMENTS)
    : remainingActionLimit;
  const closeLimit = Math.min(remainingActionLimit, budgetCloseLimit);
  if (closeLimit < 1) return result;

  const toClose = await all<VoteRow>(db, VOTE_CLOSE_DUE_QUERY, [now, now, closeLimit]);
  for (const vote of toClose) {
    const requiredStatements = vote.vote_type === "election" ? VOTE_MAX_CLOSE_STATEMENTS : VOTE_MIN_CLOSE_STATEMENTS;
    if (!hasD1QueryCapacity(d1QueryBudget, requiredStatements)) continue;
    const claimed = await claimDueVote(db, vote, now);
    if (!claimed) continue;
    const outcome = await closeClaimedVote(db, claimed, now);
    if (outcome === "closed") result.closed.push(vote.id);
    if (outcome === "round-advanced") result.roundsAdvanced.push(vote.id);
  }

  return result;
}
