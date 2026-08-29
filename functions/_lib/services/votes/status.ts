import type { VoteStatus } from "../../../../assets/shared/schemas/votes";

/**
 * Vote status is derived, never stored.
 *
 * The table records only lifecycle facts — `opened_at`, `closed_at`,
 * `cancelled_at` — which say which side effects have run. Whether the ballot
 * box is open is a question about time, and answering it from a stored string
 * meant a late transition job could leave a vote reading as open past its own
 * deadline, or as scheduled after its window had already begun.
 *
 * Both the SQL fragment and the TypeScript function below express the same
 * rule, so there is exactly one definition to keep correct.
 */
export interface VoteLifecycleFacts {
  opens_at: string;
  closes_at: string;
  opened_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
}

/**
 * `closed` covers both a finished window and a completed close: to anyone
 * asking, a vote past `closes_at` is closed whether or not the tally has been
 * frozen yet. Results are gated separately on `result_json`.
 */
export function deriveVoteStatus(vote: VoteLifecycleFacts, now: string): VoteStatus {
  if (vote.cancelled_at !== null) return "cancelled";
  if (vote.closed_at !== null || vote.closes_at <= now) return "closed";
  if (vote.opens_at <= now) return "open";
  return "scheduled";
}

/** The only correct answer to "may a ballot be cast right now". */
export function isVoteAcceptingBallots(vote: VoteLifecycleFacts, now: string): boolean {
  return deriveVoteStatus(vote, now) === "open";
}

/**
 * SQL form of the same rule. `alias` is a trusted internal table alias, never
 * caller input. Bind the current instant once and pass it for every `?`.
 */
export function voteStatusSql(alias = "votes"): string {
  return `CASE
    WHEN ${alias}.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN ${alias}.closed_at IS NOT NULL OR ${alias}.closes_at <= ? THEN 'closed'
    WHEN ${alias}.opens_at <= ? THEN 'open'
    ELSE 'scheduled'
  END`;
}

/** Number of `?` placeholders `voteStatusSql` introduces, for binding order. */
export const VOTE_STATUS_SQL_BINDINGS = 2;

/** Predicate form: the vote is accepting ballots at the bound instant. */
export function voteAcceptingBallotsSql(alias = "votes"): string {
  return `(${alias}.cancelled_at IS NULL
    AND ${alias}.closed_at IS NULL
    AND ${alias}.opens_at <= ?
    AND ${alias}.closes_at > ?)`;
}

/** Rows whose open side effects still have to run. */
export function votePendingOpenSql(alias = "votes"): string {
  return `(${alias}.opened_at IS NULL AND ${alias}.cancelled_at IS NULL AND ${alias}.opens_at <= ?)`;
}

/** Rows whose close side effects still have to run. */
export function votePendingCloseSql(alias = "votes"): string {
  return `(${alias}.closed_at IS NULL AND ${alias}.cancelled_at IS NULL AND ${alias}.closes_at <= ?)`;
}

/**
 * Binding-free ordering by lifecycle stage: still active, then closed, then
 * cancelled. Used where a sort expression cannot carry the current instant.
 */
export const VOTE_LIFECYCLE_RANK_SQL = `CASE
  WHEN cancelled_at IS NOT NULL THEN 3
  WHEN closed_at IS NOT NULL THEN 2
  ELSE 1
END`;
