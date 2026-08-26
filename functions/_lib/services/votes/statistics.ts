import type { GroupVoteStatisticsResponse } from "../../../../assets/shared/schemas/group-vote-statistics";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { VOTE_CURRENT_ROUND_ELECTION_TALLY_QUERY, VOTE_CURRENT_ROUND_MOTION_TALLY_QUERY } from "./due-queries";
import { prepareVoteManagementAuthorizationGuard } from "./vote-access";
import { VOTE_CURRENT_PARTICIPATION_STATISTICS_QUERY } from "./voter-eligibility";

interface ParticipationRow {
  vote_id: string;
  vote_type: "election" | "motion" | "consultation";
  electorate_mode: "per_member" | "per_person";
  status: "scheduled" | "open" | "closed" | "cancelled";
  current_round: number;
  current_eligible: number;
  current_eligible_cast: number;
  effective_ballots: number;
}

interface MotionCountRow {
  in_favor: number;
  opposed: number;
  abstain: number;
}

interface ElectionCountRow {
  choice: string;
  ballot_count: number;
}

interface CandidateRow {
  id: string;
  candidate_name: string;
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

/**
 * Manager-only, identity-free participation read model. Eligibility is
 * deliberately labelled as current: group participation and representation
 * can change after a ballot was cast, while the accepted ballot remains part
 * of the vote history. The two explicit counts keep that state visible rather
 * than publishing a misleading turnout percentage.
 */
export async function getVoteStatisticsForManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupId: string,
  voteId: string,
): Promise<GroupVoteStatisticsResponse> {
  let results;
  try {
    results = await db.batch([
      await prepareVoteManagementAuthorizationGuard(db, actor, voteId, groupId),
      db.prepare(VOTE_CURRENT_PARTICIPATION_STATISTICS_QUERY).bind(voteId),
      db.prepare(VOTE_CURRENT_ROUND_MOTION_TALLY_QUERY).bind(voteId),
      db.prepare(VOTE_CURRENT_ROUND_ELECTION_TALLY_QUERY).bind(voteId),
      db
        .prepare(
          `SELECT id, candidate_name
             FROM vote_candidates INDEXED BY idx_vote_candidates_vote
            WHERE vote_id = ?
            ORDER BY sort_order ASC, id ASC`,
        )
        .bind(voteId),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "VOTE_MANAGEMENT_CHANGED", "Vote management permission changed during the read");
    }
    throw error;
  }

  const [, participationResult, motionResult, electionResult, candidateResult] = results;
  const participation = participationResult.results?.[0] as ParticipationRow | undefined;
  if (!participation) throw new AppError(404, "VOTE_NOT_FOUND", "Vote not found");

  const currentEligible = count(participation.current_eligible);
  const currentEligibleCast = count(participation.current_eligible_cast);
  const effectiveBallots = count(participation.effective_ballots);
  const electionCounts = (electionResult.results ?? []) as unknown as ElectionCountRow[];
  const candidates = (candidateResult.results ?? []) as unknown as CandidateRow[];
  return {
    voteId: participation.vote_id,
    groupId,
    round: count(participation.current_round),
    status: participation.status,
    electorateMode: participation.electorate_mode,
    participation: {
      unit: participation.electorate_mode === "per_member" ? "member" : "person",
      currentEligible,
      currentEligibleCast,
      currentEligibleNotCast: Math.max(0, currentEligible - currentEligibleCast),
      effectiveBallots,
      ballotsWithoutCurrentEligibility: Math.max(0, effectiveBallots - currentEligibleCast),
    },
    aggregate:
      participation.status === "closed"
        ? participation.vote_type === "election"
          ? {
              availability: "available",
              kind: "election",
              candidates: candidates.map((candidate) => ({
                candidateId: candidate.id,
                candidateName: candidate.candidate_name,
                count: count(electionCounts.find((row) => row.choice === candidate.id)?.ballot_count),
              })),
            }
          : {
              availability: "available",
              kind: "motion",
              counts: {
                in_favor: count((motionResult.results?.[0] as MotionCountRow | undefined)?.in_favor),
                opposed: count((motionResult.results?.[0] as MotionCountRow | undefined)?.opposed),
                abstain: count((motionResult.results?.[0] as MotionCountRow | undefined)?.abstain),
              },
            }
        : participation.status === "cancelled"
          ? { availability: "unavailable" }
          : { availability: "withheld_until_closed" },
  };
}
