import { Hono } from "hono";
import { fromHono } from "chanfana";
import userId_Router from "./[userId]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/:userId", userId_Router);

export default openapi;
