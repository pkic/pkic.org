import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { CastingVote } from "./tally";

/**
 * The chair's ballot, used to settle a tied vote by counting twice.
 *
 * The bylaws give the Chair the deciding vote on a tied Board or Executive
 * Council vote, and the vice chair acts as Chair in the Chair's absence. That
 * is read here as: the chair's own ballot decides, and if the chair did not
 * cast one, the deputy's does. A chair who abstained has declined to settle
 * the tie, so only a decisive choice is returned.
 */
const CASTING_BALLOT_QUERY = `
  SELECT ballot.choice AS choice, leadership.role_id AS role_id
    FROM vote_ballots ballot
    JOIN votes current_vote ON current_vote.id = ballot.vote_id
    JOIN user_roles leadership
      ON leadership.user_id = ballot.user_id
     AND leadership.context_type = 'group'
     AND leadership.context_id = current_vote.owner_group_id
     AND leadership.role_id IN ('role-group_lead', 'role-group_deputy_lead')
     AND leadership.revoked_at IS NULL
     AND (leadership.expires_at IS NULL OR leadership.expires_at > ?)
   WHERE ballot.vote_id = ?
     AND ballot.round = ?
     AND ballot.choice IN ('in_favor', 'opposed')
   ORDER BY CASE leadership.role_id WHEN 'role-group_lead' THEN 0 ELSE 1 END
   LIMIT 1`;

export async function findCastingVote(
  db: DatabaseLike,
  voteId: string,
  round: number,
  now: string,
): Promise<CastingVote | null> {
  const row = await first<{ choice: string; role_id: string }>(db, CASTING_BALLOT_QUERY, [now, voteId, round]);
  if (!row) return null;
  return {
    choice: row.choice as CastingVote["choice"],
    role: row.role_id === "role-group_lead" ? "lead" : "deputy_lead",
  };
}
