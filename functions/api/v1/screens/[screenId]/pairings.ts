import { screenPairingResponseSchema } from "../../../../../assets/shared/schemas/event-screens";
import { screenPairingCreateRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-event-screens";
import {
  issueScreenPairingChallenge,
  serializeScreenPairingCookie,
} from "../../../../_lib/auth/screen-pairing-challenge";
import { markResponseSensitive, type AdminContext } from "../../../../_lib/db/context";
import { jsonPrivate } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { getClientIp, requireInternalSecret } from "../../../../_lib/request";

/**
 * An unpaired screen asks for a code. Nothing is stored. A venue's screens
 * share one address, and each asks again only when its code expires, so the
 * per-address limit leaves room for a whole venue restarting at once.
 */
export const ScreenPairingPost = openApiRoute(screenPairingCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "screen-pairing:ip",
    key: getClientIp(c.req.raw),
  });
  const challenge = await issueScreenPairingChallenge(requireInternalSecret(c.env), data.params.screenId);
  const response = jsonPrivate(
    screenPairingResponseSchema.parse({ code: challenge.code, expiresAt: challenge.expiresAt }),
    201,
  );
  response.headers.append("set-cookie", serializeScreenPairingCookie(challenge.token, data.params.screenId, c.req.raw));
  return response;
});
