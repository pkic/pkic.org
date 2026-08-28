import {
  getBearerToken,
  fetchSessionRow,
  assertSessionActive,
  prepareRevokeSessionRow,
} from "../../../_lib/auth/session-engine";
import {
  getUserSessionCookieToken,
  serializeExpiredUserSessionCookie,
  verifyUserSessionToken,
} from "../../../_lib/auth/user-session";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import type { AdminContext } from "../../../_lib/db/context";
import { userAuthLogoutRouteSchema } from "../../../../assets/shared/schemas/user-auth";

export const UserAuthLogout = openApiRoute(userAuthLogoutRouteSchema, async (c: AdminContext) => {
  const token = getBearerToken(c.req.raw) ?? getUserSessionCookieToken(c.req.raw);
  if (token && c.env.INTERNAL_SIGNING_SECRET) {
    const verified = await verifyUserSessionToken(c.env.INTERNAL_SIGNING_SECRET, token);
    if (verified.ok) {
      const row = await fetchSessionRow(
        c.env.DB,
        { table: "sessions", subjectColumn: "user_id" },
        verified.claims.sid,
        verified.claims.sub,
      );
      if (row) {
        assertSessionActive(row, "user");
        await prepareRevokeSessionRow(c.env.DB, "sessions", row.id).run();
      }
    }
  }
  const response = json({ success: true });
  response.headers.append("Set-Cookie", serializeExpiredUserSessionCookie(c.req.raw));
  return response;
});
