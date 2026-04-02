import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { listProposalReviews, upsertProposalReview } from "../../../../../_lib/services/proposals";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { first } from "../../../../../_lib/db/queries";
import { reviewUpsertSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestGet(
  c: any,
): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");
  const proposal = await first<{ event_id: string }>(
    c.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const reviews = await listProposalReviews(c.env.DB, proposalId);
  return json({ proposalId, reviews });
}

export async function onRequestPost(
  c: any,
): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw);
  const proposalId = c.req.param("proposalId");
  const proposal = await first<{ event_id: string }>(
    c.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(c.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const body = await parseJsonBody(c.req, reviewUpsertSchema);

  const review = await upsertProposalReview(c.env.DB, {
    proposalId,
    reviewerUserId: admin.id,
    recommendation: body.recommendation,
    score: body.score,
    reviewerComment: body.reviewerComment,
    applicantNote: body.applicantNote,
  });

  await writeAuditLog(
    c.env.DB,
    "admin",
    admin.id,
    "proposal_review_upserted",
    "proposal_review",
    review.id,
    { proposalId },
  );

  return json({ success: true, review });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }

  if (c.req.raw.method === "POST") {
    return onRequestPost(c);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
