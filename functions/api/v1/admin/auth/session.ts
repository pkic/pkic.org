import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { dispatchRequestMethod, json } from "../../../../_lib/http";
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
      // Contextual permissions, recomputed from
      // user_roles/permission_grants on every request — see
      // functions/_lib/auth/admin.ts.
      grants: admin.grants ?? [],
      expiresAt: admin.expiresAt ?? null,
    },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
