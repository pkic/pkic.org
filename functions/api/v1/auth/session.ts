import { publicUserSession } from "../../../_lib/auth/public-user-session";
import { json } from "../../../_lib/http";
import {
  getUserSessionCookieToken,
  refreshUserSessionFromRequest,
  serializeUserSessionCookie,
  USER_SESSION_TOKEN_HEADER,
} from "../../../_lib/auth/user-session";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userAuthSessionResponseSchema, userAuthSessionRouteSchema } from "../../../../assets/shared/schemas/user-auth";

export const UserAuthSession = openApiRoute(userAuthSessionRouteSchema, async (c: AdminContext) => {
  const { session, token } = await refreshUserSessionFromRequest(c.env.DB, c.req.raw, c.env);
  const response = json(userAuthSessionResponseSchema.parse({ success: true, ...publicUserSession(session) }));
  if (getUserSessionCookieToken(c.req.raw)) {
    response.headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
  } else {
    response.headers.set(USER_SESSION_TOKEN_HEADER, token);
  }
  return response;
});
