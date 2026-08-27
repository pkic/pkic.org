import type { ProposalReview, ProposalReviewPatch } from "../../../../assets/shared/schemas/proposal-reviews";
import { requireAdminDatabaseUserId } from "../../auth/admin-identity";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import type { ProposalWriteAuthorization } from "../proposal-write-authorization";
import {
  assertReviewWritable,
  auditState,
  buildProposalReviewAuditDetails,
  getReviewContext,
  REVIEW_COLUMNS,
  REVIEW_FROM,
  saveExistingProposalReview,
} from "./shared";

export async function updateProposalReview(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  reviewId: string,
  patch: ProposalReviewPatch,
  authorization?: ProposalWriteAuthorization,
): Promise<ProposalReview> {
  const reviewerUserId = requireAdminDatabaseUserId(actor);
  const context = await getReviewContext(db, actor, proposalId);
  assertReviewWritable(context);
  const existing = await first<ProposalReview>(
    db,
    `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM}
     WHERE pr.id = ? AND pr.proposal_id = ? AND pr.review_round = ?`,
    [reviewId, proposalId, context.reviewRound],
  );
  if (!existing) throw new AppError(404, "PROPOSAL_REVIEW_NOT_FOUND", "Proposal review not found");
  if (existing.reviewer_user_id !== reviewerUserId) {
    throw new AppError(403, "FORBIDDEN", "Only the review owner may edit this review");
  }

  const next = {
    reviewRound: context.reviewRound,
    recommendation: patch.recommendation ?? existing.recommendation,
    score: patch.score !== undefined ? patch.score : existing.score,
    reviewerComment: patch.reviewerComment !== undefined ? patch.reviewerComment : existing.reviewer_comment,
    applicantNote: patch.applicantNote !== undefined ? patch.applicantNote : existing.applicant_note,
  };
  const changes = buildProposalReviewAuditDetails(auditState(existing), next);
  if (Object.keys(changes).length === 0) return existing;

  return saveExistingProposalReview(db, actor, proposalId, context, existing, next, changes, authorization);
}
