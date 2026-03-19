import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { listProposalReviews, upsertProposalReview } from "../../../../../_lib/services/proposals";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { first } from "../../../../../_lib/db/queries";
import type { PagesContext } from "../../../../../_lib/types";
import { reviewUpsertSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestGet(
  context: PagesContext<{ proposalId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const proposal = await first<{ event_id: string }>(
    context.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [context.params.proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(context.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const reviews = await listProposalReviews(context.env.DB, context.params.proposalId);
  return json({ proposalId: context.params.proposalId, reviews });
}

export async function onRequestPost(
  context: PagesContext<{ proposalId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request);
  const proposal = await first<{ event_id: string }>(
    context.env.DB,
    "SELECT event_id FROM session_proposals WHERE id = ?",
    [context.params.proposalId],
  );
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(context.env.DB, proposal.event_id, admin);
  if (!access.canReview) {
    return json({ error: { code: "FORBIDDEN", message: "Missing permission to review proposals" } }, 403);
  }

  const body = await parseJsonBody(context.request, reviewUpsertSchema);

  const review = await upsertProposalReview(context.env.DB, {
    proposalId: context.params.proposalId,
    reviewerUserId: admin.id,
    recommendation: body.recommendation,
    score: body.score,
    reviewerComment: body.reviewerComment,
    applicantNote: body.applicantNote,
  });

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "proposal_review_upserted",
    "proposal_review",
    review.id,
    { proposalId: context.params.proposalId },
  );

  return json({ success: true, review });
}

export async function onRequest(context: PagesContext<{ proposalId: string }>): Promise<Response> {
  if (context.request.method === "GET") {
    return onRequestGet(context);
  }

  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
