/**
 * POST /api/v1/portal/votes/:id/ballots — cast a ballot through a
 * D1-configured voting category. ip_hash mirrors consent.ts's pattern
 * (HMAC over the request IP with INTERNAL_SIGNING_SECRET) — recorded for
 * audit purposes only, never displayed.
 */
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireMemberFromRequest } from "../../../../../_lib/auth/member";
import { getClientIp, requireInternalSecret } from "../../../../../_lib/request";
import { hmacSha256Hex } from "../../../../../_lib/utils/crypto";
import { submitBallot } from "../../../../../_lib/services/votes";
import { submitBallotResponseSchema, submitBallotRouteSchema } from "../../../../../../assets/shared/schemas/votes";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const PortalVoteBallotsPost = openApiRoute(submitBallotRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const id = data.params.id;

  const ip = getClientIp(c.req.raw);
  const ipHash = ip ? await hmacSha256Hex(requireInternalSecret(c.env), ip) : null;

  await submitBallot(db, member, id, data.body.memberId, data.body.choice, ipHash);
  return json(submitBallotResponseSchema.parse({ success: true }));
});
