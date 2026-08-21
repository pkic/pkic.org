import type { ProposalReview, ProposalReviewPatch } from "../../../../assets/shared/schemas/proposal-reviews";
import { batchFirst } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import {
  assertReviewWritable,
  auditState,
  buildProposalReviewAuditDetails,
  currentReviewOrConflict,
  getReviewContext,
  prepareReviewById,
  REVIEW_COLUMNS,
  REVIEW_FROM,
  REVIEW_WRITABLE_PROPOSAL_SQL,
  reviewWritableProposalBindings,
} from "./shared";

export async function updateProposalReview(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  reviewId: string,
  patch: ProposalReviewPatch,
): Promise<ProposalReview> {
  const context = await getReviewContext(db, actor, proposalId);
  assertReviewWritable(context);
  const existing = await first<ProposalReview>(
    db,
    `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE pr.id = ? AND pr.proposal_id = ?`,
    [reviewId, proposalId],
  );
  if (!existing) throw new AppError(404, "PROPOSAL_REVIEW_NOT_FOUND", "Proposal review not found");
  if (existing.reviewer_user_id !== actor.id && !context.access.canFinalize) {
    throw new AppError(403, "FORBIDDEN", "Only the review owner or a proposal manager may edit this review");
  }

  const next = {
    recommendation: patch.recommendation ?? existing.recommendation,
    score: patch.score !== undefined ? patch.score : existing.score,
    reviewerComment: patch.reviewerComment !== undefined ? patch.reviewerComment : existing.reviewer_comment,
    applicantNote: patch.applicantNote !== undefined ? patch.applicantNote : existing.applicant_note,
  };
  const changes = buildProposalReviewAuditDetails(auditState(existing), next);
  if (Object.keys(changes).length === 0) return existing;

  const now = nowIso();
  const [updated, , selected] = await db.batch([
    db
      .prepare(
        `UPDATE proposal_reviews
         SET recommendation = ?, score = ?, reviewer_comment = ?, applicant_note = ?, updated_at = ?
         WHERE id = ? AND proposal_id = ? AND recommendation = ? AND score IS ?
           AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ?
           AND EXISTS ${REVIEW_WRITABLE_PROPOSAL_SQL}`,
      )
      .bind(
        next.recommendation,
        next.score,
        next.reviewerComment,
        next.applicantNote,
        now,
        existing.id,
        proposalId,
        existing.recommendation,
        existing.score,
        existing.reviewer_comment,
        existing.applicant_note,
        existing.updated_at,
        ...reviewWritableProposalBindings(proposalId),
      ),
    prepareAuditLogWhen(db, {
      actorType: "admin",
      actorId: actor.id,
      action: "proposal_review_upserted",
      entityType: "proposal_review",
      entityId: existing.id,
      details: changes,
      createdAt: now,
      conditionSql:
        "SELECT 1 FROM proposal_reviews WHERE id = ? AND proposal_id = ? AND recommendation = ? AND score IS ? AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ? AND changes() = 1",
      conditionBindings: [
        existing.id,
        proposalId,
        next.recommendation,
        next.score,
        next.reviewerComment,
        next.applicantNote,
        now,
      ],
    }),
    prepareReviewById(db, existing.id),
  ]);
  if ((updated.meta?.changes ?? 0) !== 1) return currentReviewOrConflict(db, actor, proposalId, existing.id);
  const review = batchFirst<ProposalReview>(selected);
  if (!review) throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to load the updated review");
  return review;
}
