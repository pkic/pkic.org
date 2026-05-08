import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../_lib/auth/proposal-access";
import { first } from "../../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { buildProposalReviewAuditDetails, updateReviewById } from "../../../../../../_lib/services/proposals";
import { reviewPatchSchema } from "../../../../../../../assets/shared/schemas/api";

export async function onRequestPatch(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");
  const reviewId = c.req.param("reviewId");

  const proposal = await first<{ event_id: string }>(c.env.DB, "SELECT event_id FROM session_proposals WHERE id = ?", [
    proposalId,
  ]);
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const reviewBelongsToProposal = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM proposal_reviews WHERE id = ? AND proposal_id = ?",
    [reviewId, proposalId],
  );
  if (!reviewBelongsToProposal) {
    return json({ error: { code: "PROPOSAL_REVIEW_NOT_FOUND", message: "Proposal review not found" } }, 404);
  }

  const body = await parseJsonBody(c.req, reviewPatchSchema);

  const existing = await first<{
    recommendation: string;
    score: number | null;
    reviewer_comment: string | null;
    applicant_note: string | null;
  }>(
    c.env.DB,
    `SELECT recommendation, score, reviewer_comment, applicant_note
     FROM proposal_reviews
     WHERE id = ?`,
    [reviewId],
  );

  const review = await updateReviewById(c.env.DB, reviewId, body);

  if (existing) {
    const changes = buildProposalReviewAuditDetails(
      {
        recommendation: existing.recommendation,
        score: existing.score,
        reviewerComment: existing.reviewer_comment ?? null,
        applicantNote: existing.applicant_note ?? null,
      },
      {
        recommendation: review.recommendation,
        score: review.score,
        reviewerComment: review.reviewer_comment ?? null,
        applicantNote: review.applicant_note ?? null,
      },
    );

    if (Object.keys(changes).length > 0) {
      await writeAuditLog(
        c.env.DB,
        "admin",
        admin.id,
        "proposal_review_upserted",
        "proposal_review",
        review.id,
        changes,
      );
    }
  }

  return json({ success: true, review });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPatch(c);
}
