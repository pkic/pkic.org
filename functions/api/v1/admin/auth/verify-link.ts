import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { verifyAdminMagicLink } from "../../../../_lib/auth/admin";
import { writeAuditLog } from "../../../../_lib/services/audit";
import type { PagesContext } from "../../../../_lib/types";
import { adminAuthVerifySchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody(context.request, adminAuthVerifySchema);

  const verified = await verifyAdminMagicLink(context.env.DB, {
    token: body.token,
    sessionTtlHours: 8,
  });

  await writeAuditLog(
    context.env.DB,
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

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPost(context);
}
