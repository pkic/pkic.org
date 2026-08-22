import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { publicAuthAdmin } from "../../../../_lib/auth/admin-identity";
import { dispatchRequestMethod, json } from "../../../../_lib/http";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { adminAuthSessionResponseSchema } from "../../../../../assets/shared/schemas/admin-auth";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  return json(
    adminAuthSessionResponseSchema.parse({
      success: true,
      // Contextual permissions are recomputed from user_roles and
      // permission_grants on every request (see auth/admin.ts).
      admin: publicAuthAdmin(admin),
    }),
  );
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
