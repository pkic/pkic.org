/**
 * POST/GET /api/v1/portal/vote-proposals — submit or list vote proposals
 * (A–G members only).
 */
import { openApiRoute } from "../../../../_lib/openapi/route";
import { json } from "../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { submitVoteProposal, listVoteProposals } from "../../../../_lib/services/votes";
import {
  submitProposalRouteSchema,
  listProposalsQuerySchema,
  listProposalsRouteSchema,
} from "../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export const PortalVoteProposalsPost = openApiRoute(submitProposalRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const proposal = await submitVoteProposal(db, member, data.body);
  return json({ proposal });
});

// GET keeps its own query parsing (rather than the factory's validated
// data.query) because it deliberately falls back to an empty filter object
// on an invalid/unknown scopeType instead of rejecting the request —
// behavior that real schema validation would not reproduce.
export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireMemberFromRequest(db, c.req.raw, c.env);
  const url = new URL(c.req.raw.url);
  const parsed = listProposalsQuerySchema.safeParse({
    scopeType: url.searchParams.get("scopeType") ?? undefined,
    scopeId: url.searchParams.get("scopeId") ?? undefined,
  });
  const q = parsed.success ? parsed.data : {};
  const proposals = await listVoteProposals(db, q);
  return json({ proposals });
}

export const PortalVoteProposalsGet = openApiRoute(listProposalsRouteSchema, onRequestGet);
