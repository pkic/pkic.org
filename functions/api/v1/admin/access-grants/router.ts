import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AccessGrantsList, AccessGrantsCreate } from "./index";
import { AccessGrantsRevoke } from "./[id]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AccessGrantsList);
openapi.post("/", AccessGrantsCreate);
openapi.delete("/:id", AccessGrantsRevoke);

export default openapi;
