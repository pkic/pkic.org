/**
 * GET /api/v1/me/votes — my vote history (PRD §4.10).
 *
 * Stub: voting (§4.8) is Phase 4B, out of scope for Phase 4A — the
 * `votes`/`vote_ballots` tables don't exist yet. Requires a valid member
 * session (so the route is real and gated), always returns an empty list.
 * Phase 4B replaces this stub with a real query. See prd.md Phase 4A status.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { myVotesListRouteSchema } from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireMemberFromRequest(requestDb(c), c.req.raw, c.env);
  return json({ votes: [] });
}

export class MeVotesGet extends OpenAPIRoute {
  schema = myVotesListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
