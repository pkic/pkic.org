import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { json } from "../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return json({
    success: true,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      scopes: admin.scopes ?? [],
      expiresAt: admin.expiresAt ?? null,
    },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
