import { myActiveIdentitySwitchRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { requireMemberFromRequest, switchActiveIdentity } from "../../../../../_lib/auth/member";
import { sessionExpiresAtToExp } from "../../../../../_lib/auth/session-engine";
import {
  getUserSessionToken,
  signUserSessionToken,
  serializeUserSessionCookie,
  verifyUserSessionToken,
} from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../_lib/request";
import { getMyProfile } from "../../../../../_lib/services/member-self-service";

export const CurrentUserActiveIdentityPut = openApiRoute(
  myActiveIdentitySwitchRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const switched = await switchActiveIdentity(db, member, data.body.identityId);

    const secret = requireInternalSecret(c.env);
    const currentToken = getUserSessionToken(c.req.raw);
    const currentClaims = currentToken ? await verifyUserSessionToken(secret, currentToken) : null;
    const token = await signUserSessionToken(secret, {
      sub: switched.userId,
      sid: switched.sessionId!,
      exp: sessionExpiresAtToExp(switched.expiresAt!),
      identityId: switched.identityId,
      state: currentClaims?.ok ? currentClaims.claims.state : undefined,
    });

    const response = jsonPrivate(await getMyProfile(db, switched));
    response.headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
    return response;
  },
);
