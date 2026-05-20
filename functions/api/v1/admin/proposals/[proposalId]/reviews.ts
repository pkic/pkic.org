import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import {
  buildProposalReviewAuditDetails,
  listProposalReviews,
  upsertProposalReview,
} from "../../../../../_lib/services/proposals";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { first } from "../../../../../_lib/db/queries";
import { reviewUpsertSchema } from "../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const proposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const reviews = await listProposalReviews(requestDb(c), proposalId);
  return json({ proposalId, reviews });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const proposal = await first<{ event_id: string }>(
    requestDb(c),
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, reviewUpsertSchema);
  const existing = await first<{
    id: string;
    recommendation: string;
    score: number | null;
    reviewer_comment: string | null;
    applicant_note: string | null;
  }>(
    requestDb(c),
    `SELECT id, recommendation, score, reviewer_comment, applicant_note
     FROM proposal_reviews
     WHERE proposal_id = ? AND reviewer_user_id = ?`,
    [proposalId, admin.id],
  );

  const review = await upsertProposalReview(requestDb(c), {
    proposalId,
    reviewerUserId: admin.id,
    recommendation: body.recommendation,
    score: body.score,
    reviewerComment: body.reviewerComment,
    applicantNote: body.applicantNote,
  });

  const before = {
    recommendation: existing?.recommendation ?? null,
    score: existing?.score ?? null,
    reviewerComment: existing?.reviewer_comment ?? null,
    applicantNote: existing?.applicant_note ?? null,
  };
  const after = {
    recommendation: review.recommendation,
    score: review.score,
    reviewerComment: review.reviewer_comment ?? null,
    applicantNote: review.applicant_note ?? null,
  };

  const changes = buildProposalReviewAuditDetails(before, after);
  if (Object.keys(changes).length > 0) {
    await writeAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "proposal_review_upserted",
      "proposal_review",
      review.id,
      changes,
    );
  }

  return json({ success: true, review });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }

  if (c.req.raw.method === "POST") {
    return onRequestPost(c);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
