import type { ProposalReview } from "../../../../assets/shared/schemas/proposal-reviews";
import {
  isProposalDecisionStatus,
  PROPOSAL_DECISION_STATUSES,
} from "../../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent, type ProposalAccess } from "../../auth/proposal-access";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";

export const REVIEW_COLUMNS = `pr.id, pr.proposal_id, pr.reviewer_user_id, pr.recommendation,
  pr.score, pr.reviewer_comment, pr.applicant_note, pr.created_at, pr.updated_at,
  u.email AS reviewer_email, u.first_name AS reviewer_first_name,
  u.last_name AS reviewer_last_name`;
export const REVIEW_FROM = "FROM proposal_reviews pr JOIN users u ON u.id = pr.reviewer_user_id";
const DECISION_STATUS_PLACEHOLDERS = PROPOSAL_DECISION_STATUSES.map(() => "?").join(", ");

/** Re-check the review lock in the write statement so finalization cannot win between the service read and write. */
export const REVIEW_WRITABLE_PROPOSAL_SQL = `(
  SELECT 1
  FROM session_proposals sp
  WHERE sp.id = ?
    AND sp.deleted_at IS NULL
    AND sp.status NOT IN (${DECISION_STATUS_PLACEHOLDERS})
    AND NOT EXISTS (SELECT 1 FROM proposal_decisions pd WHERE pd.proposal_id = sp.id)
)`;

export function reviewWritableProposalBindings(proposalId: string): unknown[] {
  return [proposalId, ...PROPOSAL_DECISION_STATUSES];
}

export interface ProposalReviewContext {
  status: string;
  hasDecision: boolean;
  access: ProposalAccess;
}

export type ReviewAuditState = Record<"recommendation" | "score" | "reviewerComment" | "applicantNote", unknown>;

export async function getReviewContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
): Promise<ProposalReviewContext> {
  const proposal = await first<{ event_id: string; status: string; has_decision: number }>(
    db,
    `SELECT sp.event_id, sp.status,
            EXISTS (SELECT 1 FROM proposal_decisions pd WHERE pd.proposal_id = sp.id) AS has_decision
     FROM session_proposals sp WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, actor);
  if (!access.canReview) throw new AppError(403, "FORBIDDEN", "Missing permission to review proposals");
  return { status: proposal.status, hasDecision: Boolean(proposal.has_decision), access };
}

export function assertReviewWritable(context: ProposalReviewContext): void {
  if (context.hasDecision || isProposalDecisionStatus(context.status)) {
    throw new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Cannot change reviews after a proposal decision");
  }
}

export function auditState(review: ProposalReview | null): ReviewAuditState {
  return {
    recommendation: review?.recommendation ?? null,
    score: review?.score ?? null,
    reviewerComment: review?.reviewer_comment ?? null,
    applicantNote: review?.applicant_note ?? null,
  };
}

export function buildProposalReviewAuditDetails(
  before: ReviewAuditState,
  after: ReviewAuditState,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof ReviewAuditState>) {
    if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export function isReviewOwnerConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("proposal_reviews.proposal_id") &&
    error.message.includes("proposal_reviews.reviewer_user_id")
  );
}

export function prepareReviewById(db: DatabaseLike, reviewId: string): StatementLike {
  return db.prepare(`SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE pr.id = ?`).bind(reviewId);
}

export async function currentReviewOrConflict(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  reviewId: string,
): Promise<never> {
  assertReviewWritable(await getReviewContext(db, actor, proposalId));
  const current = await first<{ id: string }>(db, "SELECT id FROM proposal_reviews WHERE id = ?", [reviewId]);
  if (!current) throw new AppError(404, "PROPOSAL_REVIEW_NOT_FOUND", "Proposal review not found");
  throw new AppError(409, "PROPOSAL_REVIEW_CONFLICT", "Proposal review changed while the update was processed");
}
