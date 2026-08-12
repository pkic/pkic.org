/**
 * POST/DELETE /api/v1/portal/vote-proposals/:id/endorse — endorse a
 * proposal, or withdraw my own endorsement (A–G members only).
 * Endorsing auto-converts the proposal to an active vote once the
 * endorsement threshold is reached.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { endorseVoteProposal, withdrawEndorsement } from "../../../../../_lib/services/votes";
import {
  endorseProposalRouteSchema,
  withdrawEndorsementRouteSchema,
} from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  const result = await endorseVoteProposal(db, member, id);
  return json(result);
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = c.req.param("id");
  await withdrawEndorsement(db, member, id);
  return json({ success: true });
}

export class PortalVoteProposalEndorsePost extends OpenAPIRoute {
  schema = endorseProposalRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

export class PortalVoteProposalEndorseDelete extends OpenAPIRoute {
  schema = withdrawEndorsementRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
