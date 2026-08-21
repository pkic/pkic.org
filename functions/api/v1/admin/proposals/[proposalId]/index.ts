/**
 * GET /api/v1/admin/proposals/:proposalId
 *
 * Returns a single proposal with its proposer info, review count, decision,
 * and the requesting admin's access rights for that event.
 */
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getConfig } from "../../../../../_lib/config";
import { getAdminProposalDetailData } from "../../../../../_lib/services/proposal-admin-detail";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { proposalIdParamsSchema } from "../../../../../../assets/shared/schemas/api";
import { adminProposalDetailResponseSchema } from "../../../../../../assets/shared/schemas/admin-event-proposals";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const detail = await getAdminProposalDetailData(requestDb(c), proposalId);
  if (!detail) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), detail.eventId, admin);
  const config = getConfig(c.env, c.req.raw);

  return json(
    adminProposalDetailResponseSchema.parse({
      proposal: detail.proposal,
      access,
      form: detail.form,
      minReviewsRequired: config.minProposalReviews,
      sessionTypes: detail.sessionTypes,
    }),
  );
}

export const AdminProposalsProposalIdGet = openApiRoute(
  {
    tags: ["Admin proposals"],
    summary: "Get proposal details",
    request: {
      params: proposalIdParamsSchema,
    },
    responses: {
      "200": {
        description: "Proposal details visible to the authenticated actor.",
        content: { "application/json": { schema: adminProposalDetailResponseSchema } },
      },
      "401": { description: "Missing or invalid authentication." },
      "404": { description: "Proposal not found." },
    },
  },
  onRequestGet,
);
