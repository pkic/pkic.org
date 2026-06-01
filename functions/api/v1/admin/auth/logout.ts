import {
  getAdminSessionCookieToken,
  revokeAdminSession,
  serializeExpiredAdminSessionCookie,
  verifyAdminSessionToken,
} from "../../../../_lib/auth/admin";
import { json } from "../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { requireInternalSecret } from "../../../../_lib/request";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const token = getAdminSessionCookieToken(c.req.raw);
  if (token) {
    const verified = await verifyAdminSessionToken(requireInternalSecret(c.env), token);
    if (verified.ok) {
      await revokeAdminSession(requestDb(c), verified.claims.sid);
    }
  }

  const response = json({ success: true });
  response.headers.append("Set-Cookie", serializeExpiredAdminSessionCookie(c.req.raw));
  return response;
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
