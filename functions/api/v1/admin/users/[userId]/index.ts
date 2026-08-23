/** GET/PATCH /api/v1/admin/users/:userId — admin user detail and account/profile update. */
import {
  adminUserUpdateRouteSchema,
  adminUserUpdateResponseSchema,
  adminUserUpdateSchema,
  adminUserDetailResponseSchema,
  adminUserDetailRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-users";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { getAdminUserDetail } from "../../../../../_lib/services/admin-user-detail";
import { updateAdminUser } from "../../../../../_lib/services/admin-user-update";
import { parseJsonBody } from "../../../../../_lib/validation";
import type { ValidatedData } from "chanfana";

export const AdminUsersUserIdGet = openApiRoute(adminUserDetailRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(
    adminUserDetailResponseSchema.parse({ user: await getAdminUserDetail(requestDb(c), data.params.userId) }),
  );
});

export async function onRequestPatch(
  c: AdminContext,
  data?: ValidatedData<typeof adminUserUpdateRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const input = data?.body ?? (await parseJsonBody(c.req, adminUserUpdateSchema));
  const userId = data?.params.userId ?? c.req.param("userId");
  return json(
    adminUserUpdateResponseSchema.parse({
      success: true,
      user: await updateAdminUser(requestDb(c), admin, userId, input),
    }),
  );
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { PATCH: onRequestPatch });
}
