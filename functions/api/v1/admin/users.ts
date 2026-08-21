/**
 * GET /api/v1/admin/users
 *
 * Returns a pageable list of users.  Designed for the admin console's user
 * management section; supports filtering by role and a simple email/name search.
 *
 * Query params (see usersListQuerySchema, assets/shared/schemas/admin-users.ts):
 *   role   — filter to a specific role (admin | user | guest)
 *   type   — filter by computed membership type (member | event_attendee | contact_only)
 *   q      — partial match against email or name
 *   sort   — allowlisted column, optionally `-`-prefixed for descending
 *   limit  — max rows (default 50, shared maximum 200)
 *   offset — pagination offset (default 0)
 */
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { usersListRouteSchema } from "../../../../assets/shared/schemas/admin-users";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { listAdminUsers } from "../../../_lib/services/admin-users-list";
import { openApiRoute } from "../../../_lib/openapi/route";

export const UsersList = openApiRoute(usersListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  return json(await listAdminUsers(requestDb(c), data.query));
});
