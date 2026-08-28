import type { ValidatedData } from "chanfana";
import {
  userDetailResponseSchema,
  userDetailRouteSchema,
  userUpdateResponseSchema,
  userUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/user-management";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getUserDetail } from "../../../../_lib/services/user-management-detail";
import { updateUser } from "../../../../_lib/services/user-management-update";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireUserStaffPermission } from "../authorization";

export const UserGet = openApiRoute(userDetailRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireUserStaffPermission(c, "users:read");
  return json(userDetailResponseSchema.parse({ user: await getUserDetail(db, data.params.userId) }));
});

async function handleUserUpdate(c: AdminContext, data: ValidatedData<typeof userUpdateRouteSchema>): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");
  return json(
    userUpdateResponseSchema.parse({
      success: true,
      user: await updateUser(db, staff, data.params.userId, data.body),
    }),
  );
}

export const UserPatch = openApiRoute(userUpdateRouteSchema, handleUserUpdate);
