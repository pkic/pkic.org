import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { verifyAdminMagicLink } from "../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { adminAuthVerifySchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  const body = await parseJsonBody(c.req, adminAuthVerifySchema);

  const verified = await verifyAdminMagicLink(c.env.DB, {
    token: body.token,
    sessionTtlHours: 8,
  });

  await writeAuditLog(
    c.env.DB,
    "admin",
    verified.admin.id,
    "admin_magic_link_verified",
    "admin_session",
    null,
    { expiresAt: verified.expiresAt },
  );

  return json({
    success: true,
    token: verified.sessionToken,
    expiresAt: verified.expiresAt,
    admin: verified.admin,
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(c);
}
