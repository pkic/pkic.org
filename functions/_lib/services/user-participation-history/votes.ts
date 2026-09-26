/**
 * The votes a person cast a ballot in — and only that they did.
 *
 * Whether the choice is shown is the VOTE's decision, not the reader's.
 *
 * A vote already carries `visibility` and `publicDetailLevel`; a ballot's
 * choice is published exactly when that vote was configured as `public` with
 * `full_breakdown`, and is NULL otherwise. The CASE below is what enforces it,
 * in the projection rather than in the mapping — a column selected and dropped
 * later leaves the disclosure one careless line away.
 *
 * This is deliberately not a permission check on the reader. The management
 * ballot audit still answers "how did this group vote", guarded by
 * `requireVoteManagementAccess`; this answers "what has this person taken part
 * in", and a vote the group chose to keep private stays private here however
 * senior the reader is.
 *
 * One row per ballot rather than per vote: a representative voting for two
 * Members, or a voter taking part in each round of an eliminating election,
 * took part that many times, and `(vote, member, round)` is what the table's
 * own uniqueness is built on.
 */
import {
  userVoteParticipationListResponseSchema,
  type ParticipationHistoryListQuery,
  type UserVoteParticipation,
  type UserVoteParticipationListResponse,
} from "../../../../assets/shared/schemas/user-participation-history";
import type { VoteType } from "../../../../assets/shared/schemas/votes";
import type { OffsetPageQuery } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { buildParticipationHistoryPageQuery, loadParticipationHistoryPage } from "./history-page";

interface VoteParticipationRow {
  vote_id: string;
  vote_slug: string;
  vote_title: string;
  vote_type: VoteType;
  group_id: string;
  group_slug: string;
  group_name: string;
  round: number;
  occurred_at: string;
  /** NULL unless the vote publishes a full breakdown. */
  choice: string | null;
}

/** `votes.owner_group_id` is required, so the group join is inner. */
const VOTE_PARTICIPATION_FROM = `FROM vote_ballots ballot
  JOIN votes vote ON vote.id = ballot.vote_id
  JOIN groups owner_group ON owner_group.id = vote.owner_group_id`;

/** Exported so `tests/user-participation-history.test.ts` can assert the page/count pair. */
export function buildUserVoteParticipationPageQuery(
  userId: string,
  query: ParticipationHistoryListQuery,
): OffsetPageQuery {
  return buildParticipationHistoryPageQuery(query, {
    // The choice is projected only for a vote that publishes one. See the
    // note at the top of this file.
    selectSql: `SELECT ballot.vote_id, ballot.round, ballot.submitted_at AS occurred_at,
         vote.slug AS vote_slug, vote.title AS vote_title, vote.vote_type,
         owner_group.id AS group_id, owner_group.slug AS group_slug, owner_group.name AS group_name,
         CASE
           WHEN vote.visibility = 'public' AND vote.public_detail_level = 'full_breakdown'
           THEN ballot.choice
           ELSE NULL
         END AS choice`,
    fromSql: VOTE_PARTICIPATION_FROM,
    conditions: ["ballot.user_id = ?"],
    bindings: [userId],
    searchColumns: ["vote.title", "owner_group.name"],
    occurredAtExpression: "ballot.submitted_at",
    tieBreaker: "ballot.id ASC",
  });
}

function toVoteParticipation(row: VoteParticipationRow): UserVoteParticipation {
  return {
    voteId: row.vote_id,
    voteSlug: row.vote_slug,
    voteTitle: row.vote_title,
    voteType: row.vote_type,
    group: { id: row.group_id, slug: row.group_slug, name: row.group_name },
    round: row.round,
    occurredAt: row.occurred_at,
    choice: row.choice,
  };
}

export async function listUserVoteParticipation(
  db: DatabaseLike,
  userId: string,
  query: ParticipationHistoryListQuery,
): Promise<UserVoteParticipationListResponse> {
  return userVoteParticipationListResponseSchema.parse(
    await loadParticipationHistoryPage<VoteParticipationRow, UserVoteParticipation>(
      db,
      "votes",
      buildUserVoteParticipationPageQuery(userId, query),
      toVoteParticipation,
    ),
  );
}
