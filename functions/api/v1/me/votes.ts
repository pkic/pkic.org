/**
 * GET /api/v1/me/votes — my vote history (PRD §4.10). Replaces the Phase
 * 4A stub now that the voting system (§4.8, Phase 4B) is built — see
 * votes.ts's listMyVoteHistory.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { listMyVoteHistory } from "../../../_lib/services/votes";
import { myVotesListRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const votes = await listMyVoteHistory(db, member);
  return json({ votes });
}

export class MeVotesGet extends OpenAPIRoute {
  schema = myVotesListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
