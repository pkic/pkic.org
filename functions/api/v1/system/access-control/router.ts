import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { SystemAccessControlContextsList, SystemAccessControlUsersList } from "./catalogs";
import { SystemAccessGrantsCreate, SystemAccessGrantsList, SystemAccessGrantsRevoke } from "./grants";
import { SystemRoleAssignmentsList, SystemRolesCreate, SystemRolesDelete, SystemRolesList } from "./roles";
import {
  SystemUserRolesAssign,
  SystemUserRolesList,
  SystemUserRolesRevoke,
  SystemUserRolesUpdateExpiry,
} from "./user-roles";
import { requireStaffAnyPermission } from "../../../../_lib/auth/staff-permissions";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  await next();
});

openapi.get("/users", SystemAccessControlUsersList);
openapi.get("/contexts", SystemAccessControlContextsList);
openapi.get("/grants", SystemAccessGrantsList);
openapi.post("/grants", SystemAccessGrantsCreate);
openapi.delete("/grants/:id", SystemAccessGrantsRevoke);
openapi.get("/roles", SystemRolesList);
openapi.post("/roles", SystemRolesCreate);
openapi.get("/roles/:id/assignments", SystemRoleAssignmentsList);
openapi.delete("/roles/:id", SystemRolesDelete);
openapi.get("/users/:userId/roles", SystemUserRolesList);
openapi.post("/users/:userId/roles", SystemUserRolesAssign);
openapi.delete("/users/:userId/roles/:userRoleId", SystemUserRolesRevoke);
openapi.patch("/users/:userId/roles/:userRoleId", SystemUserRolesUpdateExpiry);

export default openapi;
