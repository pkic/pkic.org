import { Hono } from "hono";
import { fromHono } from "chanfana";
import { UserRolesList, UserRolesAssign } from "./index";
import { UserRolesRevoke } from "./[userRoleId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", UserRolesList);
openapi.post("/", UserRolesAssign);
openapi.delete("/:userRoleId", UserRolesRevoke);

export default openapi;
