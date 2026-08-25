import { publicPortalSession, resolvePortalSessionFromRequest } from "../../../../_lib/auth/portal";
import { clearIdentitySessionCookies } from "../../../../_lib/auth/http-flow";
import { isAppError } from "../../../../_lib/errors";
import { handleError, json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import {
  portalAuthSessionRouteSchema,
  portalSessionResponseSchema,
} from "../../../../../assets/shared/schemas/portal-auth";

export const PortalAuthSession = openApiRoute(portalAuthSessionRouteSchema, async (c: AdminContext) => {
  try {
    const result = await resolvePortalSessionFromRequest(requestDb(c), c.req.raw, c.env);
    return json(portalSessionResponseSchema.parse({ success: true, ...publicPortalSession(result) }));
  } catch (error) {
    if (isAppError(error) && error.code === "PORTAL_IDENTITY_MISMATCH") {
      return clearIdentitySessionCookies(handleError(error), c.req.raw);
    }
    throw error;
  }
});
