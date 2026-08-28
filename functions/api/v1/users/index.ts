import { usersListResponseSchema, usersListRouteSchema } from "../../../../assets/shared/schemas/user-management";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listUsers } from "../../../_lib/services/user-management-list";
import type { AdminContext } from "../../../_lib/db/context";
import { requireUserStaffPermission } from "./authorization";

export const UsersList = openApiRoute(usersListRouteSchema, async (c: AdminContext, data) => {
  const { db } = await requireUserStaffPermission(c, "users:read");
  return json(usersListResponseSchema.parse(await listUsers(db, data.query)));
});
