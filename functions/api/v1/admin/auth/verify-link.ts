import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { serializeAdminSessionCookie, signAdminSessionToken, verifyAdminMagicLink } from "../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../../../_lib/request";
import { enforceRateLimit } from "../../../../_lib/rate-limit";
import { adminAuthVerifySchema } from "../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import type { DatabaseSessionLike } from "../../../../_lib/db/session";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const body = await parseJsonBody(c.req, adminAuthVerifySchema);
  const secret = requireInternalSecret(c.env);
  const clientIp = getClientIp(c.req.raw);
  // Defense-in-depth: rate-limit verification attempts per IP to limit token
  // brute-force / context-probing even though tokens have high entropy.
  await enforceRateLimit({
    binding: c.env.IP_RATE_LIMITER,
    namespace: "admin-auth-verify-link:ip",
    key: clientIp,
  });
  const db = requestDb(c) as DatabaseSessionLike;
  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(clientIp, secret),
    hashOptional(getUserAgent(c.req.raw), secret),
  ]);

  const verified = await verifyAdminMagicLink(db, {
    token: body.token,
    sessionTtlHours: 8,
    ipHash,
    userAgentHash,
  });

  await writeAuditLog(db, "admin", verified.admin.id, "admin_magic_link_verified", "admin_session", null, {
    expiresAt: verified.expiresAt,
  });
  const token = await signAdminSessionToken(secret, {
    admin: verified.admin,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
    state: db.getBookmark?.(),
  });

  const response = json({
    success: true,
    token,
    expiresAt: verified.expiresAt,
    admin: verified.admin,
  });
  response.headers.append("Set-Cookie", serializeAdminSessionCookie(token, c.req.raw));
  return response;
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
