import {
  isProposalDecisionTransitionAllowed,
  type ProposalDecisionStatus,
} from "../../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent } from "../../auth/proposal-access";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";

export interface ProposalDecisionContext {
  id: string;
  event_id: string;
  status: string;
  review_round: number;
  updated_at: string;
  review_count: number;
  current_decision_id: string | null;
  current_decision_status: string | null;
  current_decision_sequence: number | null;
  previous_review_round: number | null;
  previous_status: string | null;
  previous_note: string | null;
}

const DECISION_COLUMNS = `sp.id, sp.event_id, sp.status, sp.review_round, sp.updated_at,
  (SELECT COUNT(*) FROM proposal_reviews pr
   WHERE pr.proposal_id = sp.id AND pr.review_round = sp.review_round) AS review_count,
  pd.id AS current_decision_id,
  pd.final_status AS current_decision_status,
  pd.decision_sequence AS current_decision_sequence,
  (SELECT pdh.review_round FROM proposal_decision_history pdh
   WHERE pdh.proposal_id = sp.id
   ORDER BY pdh.review_round DESC, pdh.decision_sequence DESC LIMIT 1) AS previous_review_round,
  (SELECT pdh.final_status FROM proposal_decision_history pdh
   WHERE pdh.proposal_id = sp.id
   ORDER BY pdh.review_round DESC, pdh.decision_sequence DESC LIMIT 1) AS previous_status,
  (SELECT pdh.decision_note FROM proposal_decision_history pdh
   WHERE pdh.proposal_id = sp.id
   ORDER BY pdh.review_round DESC, pdh.decision_sequence DESC LIMIT 1) AS previous_note`;

export async function getProposalDecisionContext(
  db: DatabaseLike,
  proposalId: string,
): Promise<ProposalDecisionContext | null> {
  return first<ProposalDecisionContext>(
    db,
    `SELECT ${DECISION_COLUMNS}
     FROM session_proposals sp
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
}

export function assertProposalDecisionStateAllowed(
  state: { status: string; current_decision_id: string | null; current_decision_status: string | null },
  finalStatus: ProposalDecisionStatus,
): void {
  if (isProposalDecisionTransitionAllowed(state.status, state.current_decision_status, finalStatus)) return;
  if (state.current_decision_id) {
    throw new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Proposal already has a decision for this review round");
  }
  throw new AppError(409, "PROPOSAL_NOT_DECIDABLE", `A proposal in status '${state.status}' cannot be finalized`);
}

export function assertProposalDecisionAllowed(
  context: ProposalDecisionContext | null,
  finalStatus: ProposalDecisionStatus,
  minReviewsRequired: number,
  expectedProposalUpdatedAt?: string,
): asserts context is ProposalDecisionContext {
  if (!context) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  assertProposalDecisionStateAllowed(context, finalStatus);
  if (expectedProposalUpdatedAt && context.updated_at !== expectedProposalUpdatedAt) {
    throw new AppError(409, "PROPOSAL_DECISION_CONFLICT", "Proposal changed while the decision was prepared");
  }
  if (Number(context.review_count) < minReviewsRequired) {
    throw new AppError(
      409,
      "PROPOSAL_REVIEW_THRESHOLD_NOT_MET",
      `At least ${minReviewsRequired} current-round reviews required before finalizing`,
      { reviewCount: Number(context.review_count), minRequired: minReviewsRequired },
    );
  }
}

export async function assertProposalFinalizeAccess(db: DatabaseLike, eventId: string, actor: AuthAdmin): Promise<void> {
  const access = await getProposalAccessForEvent(db, eventId, actor);
  if (!access.canFinalize) {
    throw new AppError(403, "FORBIDDEN", "Missing permission to finalize proposals");
  }
}

export function isCurrentProposalDecisionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("proposal_decisions.proposal_id")
  );
}

export function isProposalDecisionHistoryConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("proposal_decision_history.proposal_id") &&
    error.message.includes("proposal_decision_history.review_round") &&
    error.message.includes("proposal_decision_history.decision_sequence")
  );
}

export async function throwProposalDecisionConflict(
  db: DatabaseLike,
  proposalId: string,
  finalStatus: ProposalDecisionStatus,
  minReviewsRequired: number,
  expectedProposalUpdatedAt?: string,
): Promise<never> {
  const current = await getProposalDecisionContext(db, proposalId);
  assertProposalDecisionAllowed(current, finalStatus, minReviewsRequired, expectedProposalUpdatedAt);
  throw new AppError(409, "PROPOSAL_DECISION_CONFLICT", "Proposal changed while the decision was recorded");
}
