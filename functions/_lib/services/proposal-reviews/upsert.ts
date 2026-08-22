import type { ProposalReview, ProposalReviewUpsert } from "../../../../assets/shared/schemas/proposal-reviews";
import { requireAdminDatabaseUserId } from "../../auth/admin-identity";
import { batchFirst } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import {
  assertReviewWritable,
  auditState,
  buildProposalReviewAuditDetails,
  getReviewContext,
  isReviewOwnerConflict,
  prepareReviewById,
  REVIEW_COLUMNS,
  REVIEW_FROM,
  REVIEW_WRITABLE_PROPOSAL_SQL,
  reviewWritableProposalBindings,
  saveExistingProposalReview,
  type ReviewAuditState,
} from "./shared";

export async function upsertProposalReview(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  payload: ProposalReviewUpsert,
): Promise<ProposalReview> {
  const reviewerUserId = requireAdminDatabaseUserId(actor);
  const context = await getReviewContext(db, actor, proposalId);
  assertReviewWritable(context);
  const existing = await first<ProposalReview>(
    db,
    `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE pr.proposal_id = ? AND pr.reviewer_user_id = ?`,
    [proposalId, reviewerUserId],
  );
  const nextState: ReviewAuditState = {
    reviewRound: context.reviewRound,
    recommendation: payload.recommendation,
    score: payload.score,
    reviewerComment: payload.reviewerComment ?? null,
    applicantNote: payload.applicantNote ?? null,
  };
  const changes = buildProposalReviewAuditDetails(auditState(existing), nextState);
  if (existing && Object.keys(changes).length === 0) return existing;

  const now = nowIso();
  if (!existing) {
    const reviewId = uuid();
    try {
      const [inserted, , selected] = await db.batch([
        db
          .prepare(
            `INSERT INTO proposal_reviews (
               id, proposal_id, reviewer_user_id, review_round, recommendation, score,
               reviewer_comment, applicant_note, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS ${REVIEW_WRITABLE_PROPOSAL_SQL}`,
          )
          .bind(
            reviewId,
            proposalId,
            reviewerUserId,
            context.reviewRound,
            payload.recommendation,
            payload.score,
            payload.reviewerComment ?? null,
            payload.applicantNote ?? null,
            now,
            now,
            ...reviewWritableProposalBindings(proposalId, context.reviewRound),
          ),
        prepareAuditLogWhen(db, {
          actorType: "admin",
          actorId: actor.id,
          action: "proposal_review_upserted",
          entityType: "proposal_review",
          entityId: reviewId,
          scope: { type: "proposal", id: proposalId },
          details: changes,
          createdAt: now,
          conditionSql: "SELECT 1 WHERE changes() = 1",
          conditionBindings: [],
        }),
        prepareReviewById(db, reviewId),
      ]);
      if ((inserted.meta?.changes ?? 0) !== 1) {
        assertReviewWritable(await getReviewContext(db, actor, proposalId));
        throw new AppError(409, "PROPOSAL_REVIEW_CONFLICT", "Proposal review changed while it was being saved");
      }
      const review = batchFirst<ProposalReview>(selected);
      if (!review) throw new AppError(500, "PROPOSAL_REVIEW_CREATE_FAILED", "Unable to load the created review");
      return review;
    } catch (error) {
      if (!isReviewOwnerConflict(error)) throw error;
      throw new AppError(409, "PROPOSAL_REVIEW_CONFLICT", "A review was created concurrently; reload and retry");
    }
  }

  return saveExistingProposalReview(db, actor, proposalId, context, existing, nextState, changes);
}
