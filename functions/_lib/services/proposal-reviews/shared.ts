import type { ProposalReview } from "../../../../assets/shared/schemas/proposal-reviews";
import {
  isProposalDecidableStatus,
  isProposalDecisionStatus,
  PROPOSAL_DECIDABLE_STATUSES,
} from "../../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent, type ProposalAccess } from "../../auth/proposal-access";
import { requireAdminDatabaseUserId } from "../../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "../proposal-write-authorization";

export const REVIEW_COLUMNS = `pr.id, pr.proposal_id, pr.reviewer_user_id, pr.recommendation,
  pr.review_round, pr.score, pr.reviewer_comment, pr.applicant_note, pr.created_at, pr.updated_at,
  u.email AS reviewer_email, u.first_name AS reviewer_first_name,
  u.last_name AS reviewer_last_name`;
export const REVIEW_FROM = "FROM proposal_reviews pr JOIN users u ON u.id = pr.reviewer_user_id";
const REVIEWABLE_STATUS_PLACEHOLDERS = PROPOSAL_DECIDABLE_STATUSES.map(() => "?").join(", ");

/** Re-check the review lock in the write statement so finalization cannot win between the service read and write. */
export const REVIEW_WRITABLE_PROPOSAL_SQL = `(
  SELECT 1
  FROM session_proposals sp
  WHERE sp.id = ?
    AND sp.deleted_at IS NULL
    AND sp.review_round = ?
    AND sp.status IN (${REVIEWABLE_STATUS_PLACEHOLDERS})
    AND NOT EXISTS (SELECT 1 FROM proposal_decisions pd WHERE pd.proposal_id = sp.id)
)`;

export function reviewWritableProposalBindings(proposalId: string, reviewRound: number): unknown[] {
  return [proposalId, reviewRound, ...PROPOSAL_DECIDABLE_STATUSES];
}

export interface ProposalReviewContext {
  eventId: string;
  status: string;
  reviewRound: number;
  hasDecision: boolean;
  access: ProposalAccess;
}

export type ReviewAuditState = Record<
  "reviewRound" | "recommendation" | "score" | "reviewerComment" | "applicantNote",
  unknown
>;

export async function getReviewContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
): Promise<ProposalReviewContext> {
  const proposal = await first<{ event_id: string; status: string; review_round: number; has_decision: number }>(
    db,
    `SELECT sp.event_id, sp.status, sp.review_round,
            EXISTS (SELECT 1 FROM proposal_decisions pd WHERE pd.proposal_id = sp.id) AS has_decision
     FROM session_proposals sp WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, actor);
  if (!access.canReview) throw new AppError(403, "FORBIDDEN", "Missing permission to review proposals");
  return {
    eventId: proposal.event_id,
    status: proposal.status,
    reviewRound: Number(proposal.review_round),
    hasDecision: Boolean(proposal.has_decision),
    access,
  };
}

export function assertReviewWritable(context: ProposalReviewContext): void {
  if (context.hasDecision || isProposalDecisionStatus(context.status)) {
    throw new AppError(409, "PROPOSAL_ALREADY_FINALIZED", "Cannot change reviews after a proposal decision");
  }
  if (!isProposalDecidableStatus(context.status)) {
    throw new AppError(409, "PROPOSAL_NOT_REVIEWABLE", `A proposal in status '${context.status}' cannot be reviewed`);
  }
}

export function auditState(review: ProposalReview | null): ReviewAuditState {
  return {
    reviewRound: review?.review_round ?? null,
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

export async function saveExistingProposalReview(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  context: ProposalReviewContext,
  existing: ProposalReview,
  next: ReviewAuditState,
  changes: Record<string, { from: unknown; to: unknown }>,
  authorization?: ProposalWriteAuthorization,
): Promise<ProposalReview> {
  const reviewerUserId = requireAdminDatabaseUserId(actor);
  const now = nowIso();
  let results;
  try {
    results = await db.batch(
      withProposalWriteContextGuard(authorization, [
        preparePermissionsAuthorizationGuard(db, actor, [
          { permission: "proposals:score", context: { type: "event", id: context.eventId } },
        ]),
        db
          .prepare(
            `UPDATE proposal_reviews
         SET review_round = ?, recommendation = ?, score = ?, reviewer_comment = ?, applicant_note = ?, updated_at = ?
         WHERE id = ? AND proposal_id = ? AND reviewer_user_id = ? AND review_round = ? AND recommendation = ? AND score IS ?
           AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ?
           AND EXISTS ${REVIEW_WRITABLE_PROPOSAL_SQL}`,
          )
          .bind(
            next.reviewRound,
            next.recommendation,
            next.score,
            next.reviewerComment,
            next.applicantNote,
            now,
            existing.id,
            proposalId,
            reviewerUserId,
            existing.review_round,
            existing.recommendation,
            existing.score,
            existing.reviewer_comment,
            existing.applicant_note,
            existing.updated_at,
            ...reviewWritableProposalBindings(proposalId, context.reviewRound),
          ),
        prepareAuditLogWhen(db, {
          actorType: "admin",
          actorId: actor.id,
          action: "proposal_review_upserted",
          entityType: "proposal_review",
          entityId: existing.id,
          scope: { type: "proposal", id: proposalId },
          details: changes,
          createdAt: now,
          conditionSql:
            "SELECT 1 FROM proposal_reviews WHERE id = ? AND proposal_id = ? AND reviewer_user_id = ? AND review_round = ? AND recommendation = ? AND score IS ? AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ? AND changes() = 1",
          conditionBindings: [
            existing.id,
            proposalId,
            reviewerUserId,
            next.reviewRound,
            next.recommendation,
            next.score,
            next.reviewerComment,
            next.applicantNote,
            now,
          ],
        }),
        prepareReviewById(db, existing.id),
      ]),
    );
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_REVIEW_AUTHORIZATION_CHANGED",
        "Review access changed while the review was being saved",
      );
    }
    throw error;
  }
  const offset = authorization?.contextGuard ? 1 : 0;
  const updated = results[offset + 1];
  const selected = results[offset + 3];
  if ((updated.meta?.changes ?? 0) !== 1) return currentReviewOrConflict(db, actor, proposalId, existing.id);
  const review = batchFirst<ProposalReview>(selected);
  if (!review) throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to load the updated review");
  return review;
}
