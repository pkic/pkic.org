import { myActiveIdentitySwitchRouteSchema } from "../../../../../../assets/shared/schemas/me";
import { userAuthSessionResponseSchema } from "../../../../../../assets/shared/schemas/user-auth";
import { publicUserSession } from "../../../../../_lib/auth/public-user-session";
import {
  getUserSessionCookieToken,
  refreshUserSessionFromRequest,
  serializeUserSessionCookie,
  USER_SESSION_TOKEN_HEADER,
} from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";

/** Reissues the caller's session acting as one of their own live identities. */
export const CurrentUserActiveIdentityPut = openApiRoute(
  myActiveIdentitySwitchRouteSchema,
  async (c: AdminContext, data) => {
    const { session, token } = await refreshUserSessionFromRequest(requestDb(c), c.req.raw, c.env, {
      actingIdentityId: data.body.identityId,
    });
    const response = jsonPrivate(userAuthSessionResponseSchema.parse({ success: true, ...publicUserSession(session) }));
    if (getUserSessionCookieToken(c.req.raw)) {
      response.headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
    } else {
      response.headers.set(USER_SESSION_TOKEN_HEADER, token);
    }
    return response;
  },
);
