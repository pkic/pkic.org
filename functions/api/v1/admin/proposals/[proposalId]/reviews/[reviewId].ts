import { parseJsonBody } from "../../../../../../_lib/validation";
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../../_lib/auth/proposal-access";
import { MCP_EXTENSION } from "../../../../../../_lib/openapi/mcp";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { first } from "../../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import { buildProposalReviewAuditDetails, updateReviewById } from "../../../../../../_lib/services/proposals";
import { proposalReviewIdParamsSchema, reviewPatchSchema } from "../../../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const reviewId = c.req.param("reviewId");

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

  const reviewBelongsToProposal = await first<{ id: string }>(
    requestDb(c),
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
    requestDb(c),
    `SELECT recommendation, score, reviewer_comment, applicant_note
     FROM proposal_reviews
     WHERE id = ?`,
    [reviewId],
  );

  const review = await updateReviewById(requestDb(c), reviewId, body);

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
        requestDb(c),
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

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestPatch(c);
}

export const AdminProposalsProposalIdReviewsReviewIdPatch = openApiRoute(
  {
    tags: ["Admin proposal reviews"],
    summary: "Update a proposal review",
    request: {
      params: proposalReviewIdParamsSchema,
      body: {
        content: {
          "application/json": {
            schema: reviewPatchSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      "200": { description: "The proposal review was updated." },
      "400": { description: "Invalid review payload." },
      "401": { description: "Missing or invalid authentication." },
      "403": { description: "The actor lacks review access for this proposal." },
      "404": { description: "Proposal or review not found." },
    },
    [MCP_EXTENSION]: {
      expose: true,
    },
  } as any,
  onRequestPatch,
);
