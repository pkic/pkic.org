/**
 * POST/GET /api/v1/portal/vote-proposals — submit or list vote proposals
 * (PRD §4.8 Path B, A–G members only).
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { parseJsonBody } from "../../../../_lib/validation";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { submitVoteProposal, listVoteProposals } from "../../../../_lib/services/votes";
import {
  submitProposalSchema,
  submitProposalRouteSchema,
  listProposalsQuerySchema,
  listProposalsRouteSchema,
} from "../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, submitProposalSchema);
  const proposal = await submitVoteProposal(db, member, body);
  return json({ proposal });
}

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

export class PortalVoteProposalsPost extends OpenAPIRoute {
  schema = submitProposalRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}

export class PortalVoteProposalsGet extends OpenAPIRoute {
  schema = listProposalsRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
