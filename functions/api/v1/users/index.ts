import { readStaffProjection } from "../../../_lib/auth/staff-projection";
import { requestDb } from "../../../_lib/db/context";
import { usersListResponseSchema, usersListRouteSchema } from "../../../../assets/shared/schemas/user-management";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { prepareUsersList } from "../../../_lib/services/user-management-list";
import type { AdminContext } from "../../../_lib/db/context";
import { requireUserStaffPermission } from "./authorization";
import { userCreateRouteSchema, userCreateResponseSchema } from "../../../../assets/shared/schemas/user-create";
import { createUser } from "../../../_lib/services/user-create";

export const UserCreate = openApiRoute(userCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, staff } = await requireUserStaffPermission(c, "users:write");
  return json(userCreateResponseSchema.parse(await createUser(db, staff, data.body)), 201);
});

export const UsersList = openApiRoute(usersListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  return json(
    usersListResponseSchema.parse(
      await readStaffProjection(db, c.req.raw, c.env, "users:read", prepareUsersList(db, data.query)),
    ),
  );
});
