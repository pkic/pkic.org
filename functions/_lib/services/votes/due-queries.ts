import { VOTE_CANDIDATE_COLUMNS, VOTE_ROW_COLUMNS } from "./shared";

/** Indexed, deterministic projections used by scheduled vote due-work. */
export const VOTE_OPEN_DUE_QUERY = `
  SELECT ${VOTE_ROW_COLUMNS}
  FROM votes INDEXED BY idx_votes_status_opens_at
  WHERE status = 'scheduled' AND opens_at <= ?
  ORDER BY opens_at ASC, id ASC
  LIMIT ?`;

export const VOTE_CLOSE_DUE_QUERY = `
  SELECT ${VOTE_ROW_COLUMNS}
  FROM votes INDEXED BY idx_votes_status_closes_at
  WHERE status = 'open'
    AND closes_at <= ?
    AND (transition_processing_token IS NULL OR transition_lease_expires_at <= ?)
  ORDER BY closes_at ASC, id ASC
  LIMIT ?`;

export const VOTE_STANDING_CANDIDATES_QUERY = `
  SELECT ${VOTE_CANDIDATE_COLUMNS}
  FROM vote_candidates INDEXED BY idx_vote_candidates_standing
  WHERE vote_id = ? AND eliminated_round IS NULL
  ORDER BY sort_order ASC, id ASC
  LIMIT ?`;

export const VOTE_MOTION_TALLY_QUERY = `
  SELECT
    COALESCE(SUM(CASE WHEN choice = 'in_favor' THEN 1 ELSE 0 END), 0) AS in_favor,
    COALESCE(SUM(CASE WHEN choice = 'opposed' THEN 1 ELSE 0 END), 0) AS opposed,
    COALESCE(SUM(CASE WHEN choice = 'abstain' THEN 1 ELSE 0 END), 0) AS abstain
  FROM vote_ballots INDEXED BY idx_vote_ballots_vote_round
  WHERE vote_id = ? AND round = ?`;

export const VOTE_ELECTION_TALLY_QUERY = `
  SELECT choice, COUNT(*) AS ballot_count
  FROM vote_ballots INDEXED BY idx_vote_ballots_vote_round
  WHERE vote_id = ? AND round = ?
  GROUP BY choice`;

/** Same tally shapes, but with the round resolved inside the read snapshot. */
export const VOTE_CURRENT_ROUND_MOTION_TALLY_QUERY = `
  SELECT
    COALESCE(SUM(CASE WHEN ballot.choice = 'in_favor' THEN 1 ELSE 0 END), 0) AS in_favor,
    COALESCE(SUM(CASE WHEN ballot.choice = 'opposed' THEN 1 ELSE 0 END), 0) AS opposed,
    COALESCE(SUM(CASE WHEN ballot.choice = 'abstain' THEN 1 ELSE 0 END), 0) AS abstain
  FROM votes current_vote
  LEFT JOIN vote_ballots ballot INDEXED BY idx_vote_ballots_vote_round
    ON ballot.vote_id = current_vote.id
   AND ballot.round = current_vote.current_round
  WHERE current_vote.id = ?`;

export const VOTE_CURRENT_ROUND_ELECTION_TALLY_QUERY = `
  SELECT ballot.choice, COUNT(*) AS ballot_count
  FROM votes current_vote
  JOIN vote_ballots ballot INDEXED BY idx_vote_ballots_vote_round
    ON ballot.vote_id = current_vote.id
   AND ballot.round = current_vote.current_round
  WHERE current_vote.id = ?
  GROUP BY ballot.choice`;
