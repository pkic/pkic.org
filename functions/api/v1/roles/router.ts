import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { RoleAssignmentsList, RoleCreate, RoleDelete, RoleGet, RolesList, RoleUpdate } from "./index";
import { requireStaffAnyPermission } from "../../../_lib/auth/staff-permissions";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  await requireStaffAnyPermission(c, ["access:grant", "access:revoke"]);
  await next();
});

openapi.get("/", RolesList);
openapi.post("/", RoleCreate);
openapi.get("/:id/assignments", RoleAssignmentsList);
openapi.get("/:id", RoleGet);
openapi.patch("/:id", RoleUpdate);
openapi.delete("/:id", RoleDelete);

export default openapi;
