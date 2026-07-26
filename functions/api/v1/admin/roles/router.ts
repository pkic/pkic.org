import { Hono } from "hono";
import { fromHono } from "chanfana";
import { RolesList, RolesCreate } from "./index";
import { RolesDelete } from "./[id]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", RolesList);
openapi.post("/", RolesCreate);
openapi.delete("/:id", RolesDelete);

export default openapi;
