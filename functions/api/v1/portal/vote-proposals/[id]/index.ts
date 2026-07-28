/**
 * GET/DELETE /api/v1/portal/vote-proposals/:id — proposal detail (+
 * endorsers), or withdraw my own proposal (PRD §4.8).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getVoteProposalDetail, withdrawVoteProposal } from "../../../../../_lib/services/votes";
import { proposalDetailRouteSchema, withdrawProposalRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  const result = await getVoteProposalDetail(db, id);
  return json(result);
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  await withdrawVoteProposal(db, member, id);
  return json({ success: true });
}

export class PortalVoteProposalGet extends OpenAPIRoute {
  schema = proposalDetailRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class PortalVoteProposalDelete extends OpenAPIRoute {
  schema = withdrawProposalRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
