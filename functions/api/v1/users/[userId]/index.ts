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
import { requireUserRecordReader, requireUserStaffPermission } from "../authorization";

export const UserGet = openApiRoute(userDetailRouteSchema, async (c: AdminContext, data) => {
  // The person the record is about may read it; everybody else needs
  // `users:read`. The projection is the same either way — it states nothing
  // about the reader, only about its subject — so there is one response and
  // one place that decides who gets it.
  const { db } = await requireUserRecordReader(c, data.params.userId);
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
