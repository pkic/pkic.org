import { serializeExpiredUserSessionCookie } from "../../../_lib/auth/user-session";
import { logoutUserSession } from "../../../_lib/auth/user-logout";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userAuthLogoutResponseSchema, userAuthLogoutRouteSchema } from "../../../../assets/shared/schemas/user-auth";

export const UserAuthLogout = openApiRoute(userAuthLogoutRouteSchema, async (c: AdminContext, data) => {
  const expectedSessionId = data.body?.expectedSessionId;
  const outcome = await logoutUserSession(c.env.DB, c.req.raw, c.env.INTERNAL_SIGNING_SECRET, expectedSessionId);
  const response = json(userAuthLogoutResponseSchema.parse({ success: true, outcome }));
  if (expectedSessionId === undefined)
    response.headers.append("Set-Cookie", serializeExpiredUserSessionCookie(c.req.raw));
  return response;
});
