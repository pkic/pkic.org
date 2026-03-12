import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../_lib/auth/proposal-access";
import { first } from "../../../../../../_lib/db/queries";
import { updateReviewById } from "../../../../../../_lib/services/proposals";
import type { PagesContext } from "../../../../../../_lib/types";
import { reviewPatchSchema } from "../../../../../../../shared/schemas/api";

export async function onRequestPatch(
  context: PagesContext<{ proposalId: string; reviewId: string }>,
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

  const reviewBelongsToProposal = await first<{ id: string }>(
    context.env.DB,
    "SELECT id FROM proposal_reviews WHERE id = ? AND proposal_id = ?",
    [context.params.reviewId, context.params.proposalId],
  );
  if (!reviewBelongsToProposal) {
    return json({ error: { code: "PROPOSAL_REVIEW_NOT_FOUND", message: "Proposal review not found" } }, 404);
  }

  const body = await parseJsonBody(context.request, reviewPatchSchema);

  const review = await updateReviewById(context.env.DB, context.params.reviewId, body);
  return json({ success: true, review });
}

export async function onRequest(
  context: PagesContext<{ proposalId: string; reviewId: string }>,
): Promise<Response> {
  if (context.request.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPatch(context);
}
