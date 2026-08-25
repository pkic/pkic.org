/**
 * GET/DELETE /api/v1/portal/vote-proposals/:id — proposal detail (+
 * endorsers), or withdraw my own proposal.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getVoteProposalDetailForMember, withdrawVoteProposal } from "../../../../../_lib/services/votes";
import {
  proposalDetailRouteSchema,
  withdrawProposalResponseSchema,
  withdrawProposalRouteSchema,
} from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const PortalVoteProposalGet = openApiRoute(proposalDetailRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  const result = await getVoteProposalDetailForMember(db, id, member.userId);
  return json(result);
});

export const PortalVoteProposalDelete = openApiRoute(withdrawProposalRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;
  await withdrawVoteProposal(db, member, id);
  return json(withdrawProposalResponseSchema.parse({ success: true }));
});
