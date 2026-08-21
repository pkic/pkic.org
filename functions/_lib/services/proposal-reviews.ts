import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import type { DatabaseLike } from "../types";

export interface ProposalReviewRecord {
  id: string;
  proposal_id: string;
  reviewer_user_id: string;
  recommendation: "accept" | "reject" | "needs-work";
  score: number | null;
  reviewer_comment: string | null;
  applicant_note: string | null;
  created_at: string;
  updated_at: string;
  reviewer_email?: string;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
}

export async function upsertProposalReview(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    reviewerUserId: string;
    recommendation: "accept" | "reject" | "needs-work";
    score?: number | null;
    reviewerComment?: string | null;
    applicantNote?: string | null;
  },
): Promise<ProposalReviewRecord> {
  const now = nowIso();
  const existing = await first<ProposalReviewRecord>(
    db,
    `SELECT id, proposal_id, reviewer_user_id, recommendation, score, reviewer_comment,
            applicant_note, created_at, updated_at
     FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?`,
    [payload.proposalId, payload.reviewerUserId],
  );
  if (!existing) {
    const review: ProposalReviewRecord = {
      id: uuid(),
      proposal_id: payload.proposalId,
      reviewer_user_id: payload.reviewerUserId,
      recommendation: payload.recommendation,
      score: payload.score ?? null,
      reviewer_comment: payload.reviewerComment ?? null,
      applicant_note: payload.applicantNote ?? null,
      created_at: now,
      updated_at: now,
    };
    await run(
      db,
      `INSERT INTO proposal_reviews (
        id, proposal_id, reviewer_user_id, recommendation, score,
        reviewer_comment, applicant_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        review.id,
        review.proposal_id,
        review.reviewer_user_id,
        review.recommendation,
        review.score,
        review.reviewer_comment,
        review.applicant_note,
        review.created_at,
        review.updated_at,
      ],
    );
    return review;
  }

  await run(
    db,
    `UPDATE proposal_reviews
     SET recommendation = ?, score = ?, reviewer_comment = ?, applicant_note = ?, updated_at = ?
     WHERE id = ?`,
    [
      payload.recommendation,
      payload.score ?? null,
      payload.reviewerComment ?? null,
      payload.applicantNote ?? null,
      now,
      existing.id,
    ],
  );
  const updated = await first<ProposalReviewRecord>(
    db,
    `SELECT id, proposal_id, reviewer_user_id, recommendation, score, reviewer_comment,
            applicant_note, created_at, updated_at
     FROM proposal_reviews WHERE id = ?`,
    [existing.id],
  );
  if (!updated) throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to update proposal review");
  return updated;
}

export function buildProposalReviewAuditDetails(
  before: Record<"recommendation" | "score" | "reviewerComment" | "applicantNote", unknown>,
  after: Record<"recommendation" | "score" | "reviewerComment" | "applicantNote", unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof typeof after>) {
    if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
  }
  return changes;
}

export async function listProposalReviews(db: DatabaseLike, proposalId: string): Promise<ProposalReviewRecord[]> {
  return all<ProposalReviewRecord>(
    db,
    `SELECT pr.id, pr.proposal_id, pr.reviewer_user_id, pr.recommendation, pr.score,
            pr.reviewer_comment, pr.applicant_note, pr.created_at, pr.updated_at,
            u.email AS reviewer_email, u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
     FROM proposal_reviews pr JOIN users u ON u.id = pr.reviewer_user_id
     WHERE pr.proposal_id = ? ORDER BY pr.updated_at DESC`,
    [proposalId],
  );
}

export async function updateReviewById(
  db: DatabaseLike,
  reviewId: string,
  payload: {
    recommendation?: "accept" | "reject" | "needs-work";
    score?: number | null;
    reviewerComment?: string | null;
    applicantNote?: string | null;
  },
): Promise<ProposalReviewRecord> {
  const existing = await first<ProposalReviewRecord>(
    db,
    `SELECT id, proposal_id, reviewer_user_id, recommendation, score, reviewer_comment,
            applicant_note, created_at, updated_at FROM proposal_reviews WHERE id = ?`,
    [reviewId],
  );
  if (!existing) throw new AppError(404, "PROPOSAL_REVIEW_NOT_FOUND", "Proposal review not found");

  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [
    ["recommendation", payload.recommendation],
    ["score", payload.score],
    ["reviewer_comment", payload.reviewerComment],
    ["applicant_note", payload.applicantNote],
  ] as const) {
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  assignments.push("updated_at = ?");
  values.push(nowIso(), reviewId);
  await run(db, `UPDATE proposal_reviews SET ${assignments.join(", ")} WHERE id = ?`, values);

  const updated = await first<ProposalReviewRecord>(
    db,
    `SELECT id, proposal_id, reviewer_user_id, recommendation, score, reviewer_comment,
            applicant_note, created_at, updated_at FROM proposal_reviews WHERE id = ?`,
    [reviewId],
  );
  if (!updated) throw new AppError(500, "PROPOSAL_REVIEW_UPDATE_FAILED", "Unable to update proposal review");
  return updated;
}
