/**
 * POST/GET /api/v1/portal/vote-proposals — submit or list vote proposals
 * (A–G members only).
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { submitVoteProposal, listVoteProposals } from "../../../../_lib/services/votes";
import {
  listProposalsRouteSchema,
  submitProposalResponseSchema,
  submitProposalRouteSchema,
} from "../../../../../assets/shared/schemas/votes";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const PortalVoteProposalsPost = openApiRoute(submitProposalRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const proposal = await submitVoteProposal(db, member, data.body);
  return json(submitProposalResponseSchema.parse({ proposal }));
});

export const PortalVoteProposalsGet = openApiRoute(listProposalsRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  await requireMemberFromRequest(db, c.req.raw, c.env);
  const q = data.query;
  const { limit, offset } = q;
  const { proposals, total } = await listVoteProposals(db, { ...q, limit, offset });
  return json({ proposals, page: buildPageInfo(limit, offset, total, proposals.length) });
});
