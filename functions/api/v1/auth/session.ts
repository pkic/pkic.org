import { json } from "../../../_lib/http";
import { resolveUserSessionFromRequest, publicUserSession } from "../../../_lib/auth/user-session";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userAuthSessionResponseSchema, userAuthSessionRouteSchema } from "../../../../assets/shared/schemas/user-auth";

export const UserAuthSession = openApiRoute(userAuthSessionRouteSchema, async (c: AdminContext) => {
  const session = await resolveUserSessionFromRequest(c.env.DB, c.req.raw, c.env);
  return json(userAuthSessionResponseSchema.parse({ success: true, ...publicUserSession(session) }));
});
