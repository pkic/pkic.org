/**
 * POST /api/v1/portal/votes/:id/ballots — cast a ballot (PRD §4.8, A–G
 * only; H members may not vote). ip_hash mirrors consent.ts's pattern
 * (HMAC over the request IP with INTERNAL_SIGNING_SECRET) — recorded for
 * audit purposes only, never displayed.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseJsonBody } from "../../../../../_lib/validation";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getClientIp, requireInternalSecret } from "../../../../../_lib/request";
import { hmacSha256Hex } from "../../../../../_lib/utils/crypto";
import { submitBallot } from "../../../../../_lib/services/votes";
import { submitBallotSchema, submitBallotRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, submitBallotSchema);
  const id = c.req.param("id");

  const ip = getClientIp(c.req.raw);
  const ipHash = ip ? await hmacSha256Hex(requireInternalSecret(c.env), ip) : null;

  await submitBallot(db, member, id, body.choice, ipHash);
  return json({ success: true });
}

export class PortalVoteBallotsPost extends OpenAPIRoute {
  schema = submitBallotRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPost(c);
  }
}
