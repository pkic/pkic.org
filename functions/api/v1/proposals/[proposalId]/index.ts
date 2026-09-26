/**
 * GET /api/v1/proposals/:proposalId
 *
 * Returns a single proposal with its proposer info, review count, decision,
 * and the requesting actor's access rights for that event.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../_lib/auth/proposal-access";
import { getConfig } from "../../../../_lib/config";
import { getProposalDetailData } from "../../../../_lib/services/proposal-detail";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { eventProposalDetailResponseSchema } from "../../../../../assets/shared/schemas/event-proposals";
import { proposalDetailRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../_lib/openapi/route";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");
  const detail = await getProposalDetailData(requestDb(c), proposalId);
  if (!detail) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404);
  }

  const access = await getProposalAccessForEvent(requestDb(c), detail.eventId, admin);
  const config = getConfig(c.env, c.req.raw);

  return json(
    eventProposalDetailResponseSchema.parse({
      event: detail.event,
      proposal: detail.proposal,
      access,
      form: detail.form,
      minReviewsRequired: config.minProposalReviews,
      sessionTypes: detail.sessionTypes,
    }),
  );
}

export const ProposalGet = openApiRoute(proposalDetailRouteSchema, onRequestGet);
