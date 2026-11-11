import { screenSessionPollResponseSchema } from "../../../../../assets/shared/schemas/event-screens";
import {
  screenSessionCreateRouteSchema,
  screenSessionDeleteRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-event-screens";
import {
  readScreenPairingChallenge,
  serializeExpiredScreenPairingCookie,
} from "../../../../_lib/auth/screen-pairing-challenge";
import { serializeScreenSessionCookie, signScreenSessionToken } from "../../../../_lib/auth/screen-session";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { jsonPrivate, noContent } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { revokeScreenSessions } from "../../../../_lib/services/event-screens/screen-changes";
import { activateScreenSession } from "../../../../_lib/services/event-screens/screen-pairing";

/** The pairing page's poll: signed in once staff approved the code its challenge proves. */
export const ScreenSessionPost = openApiRoute(screenSessionCreateRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const secret = requireInternalSecret(c.env);
  const { screenId } = data.params;
  const challenge = await readScreenPairingChallenge(secret, c.req.raw, screenId);
  if (!challenge.ok) {
    if (challenge.reason === "expired")
      throw new AppError(410, "SCREEN_PAIRING_EXPIRED", "This pairing code expired. Start pairing again.");
    throw new AppError(401, "SCREEN_PAIRING_INVALID", "Start pairing to get a code.");
  }
  const result = await activateScreenSession(requestDb(c), screenId, challenge);
  if (result.status === "pending") return jsonPrivate(screenSessionPollResponseSchema.parse(result), 202);
  const token = await signScreenSessionToken(secret, { screenId, ...result });
  const response = jsonPrivate(
    screenSessionPollResponseSchema.parse({ status: "active", expiresAt: result.expiresAt }),
    201,
  );
  response.headers.append("set-cookie", serializeScreenSessionCookie(token, c.req.raw));
  response.headers.append("set-cookie", serializeExpiredScreenPairingCookie(screenId, c.req.raw));
  return response;
});

export const ScreenSessionDelete = openApiRoute(screenSessionDeleteRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  await revokeScreenSessions(requestDb(c), c.req.raw, c.env, data.params.screenId);
  return noContent();
});
