import type { ProposalReview, ProposalReviewUpsert } from "../../../../assets/shared/schemas/proposal-reviews";
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
  currentReviewOrConflict,
  getReviewContext,
  isReviewOwnerConflict,
  prepareReviewById,
  REVIEW_COLUMNS,
  REVIEW_FROM,
  REVIEW_WRITABLE_PROPOSAL_SQL,
  reviewWritableProposalBindings,
  type ReviewAuditState,
} from "./shared";

export async function upsertProposalReview(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  payload: ProposalReviewUpsert,
): Promise<ProposalReview> {
  const context = await getReviewContext(db, actor, proposalId);
  assertReviewWritable(context);
  const existing = await first<ProposalReview>(
    db,
    `SELECT ${REVIEW_COLUMNS} ${REVIEW_FROM} WHERE pr.proposal_id = ? AND pr.reviewer_user_id = ?`,
    [proposalId, actor.id],
  );
  const nextState: ReviewAuditState = {
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
               id, proposal_id, reviewer_user_id, recommendation, score,
               reviewer_comment, applicant_note, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS ${REVIEW_WRITABLE_PROPOSAL_SQL}`,
          )
          .bind(
            reviewId,
            proposalId,
            actor.id,
            payload.recommendation,
            payload.score,
            payload.reviewerComment ?? null,
            payload.applicantNote ?? null,
            now,
            now,
            ...reviewWritableProposalBindings(proposalId),
          ),
        prepareAuditLogWhen(db, {
          actorType: "admin",
          actorId: actor.id,
          action: "proposal_review_upserted",
          entityType: "proposal_review",
          entityId: reviewId,
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

  const [updated, , selected] = await db.batch([
    db
      .prepare(
        `UPDATE proposal_reviews
         SET recommendation = ?, score = ?, reviewer_comment = ?, applicant_note = ?, updated_at = ?
         WHERE id = ? AND recommendation = ? AND score IS ?
           AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ?
           AND EXISTS ${REVIEW_WRITABLE_PROPOSAL_SQL}`,
      )
      .bind(
        payload.recommendation,
        payload.score,
        payload.reviewerComment ?? null,
        payload.applicantNote ?? null,
        now,
        existing.id,
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
        "SELECT 1 FROM proposal_reviews WHERE id = ? AND recommendation = ? AND score IS ? AND reviewer_comment IS ? AND applicant_note IS ? AND updated_at = ? AND changes() = 1",
      conditionBindings: [
        existing.id,
        payload.recommendation,
        payload.score,
        payload.reviewerComment ?? null,
        payload.applicantNote ?? null,
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
