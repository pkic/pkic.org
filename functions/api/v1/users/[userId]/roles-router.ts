import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { UserRolesAssign, UserRolesList, UserRolesRevoke, UserRolesUpdateExpiry } from "./roles";
import { requireStaffAnyPermission } from "../../../../_lib/auth/staff-permissions";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  await next();
});

openapi.get("/", UserRolesList);
openapi.post("/", UserRolesAssign);
openapi.delete("/:userRoleId", UserRolesRevoke);
openapi.patch("/:userRoleId", UserRolesUpdateExpiry);

export default openapi;
