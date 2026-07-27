import { Hono } from "hono";
import { fromHono } from "chanfana";
import eventId_Router from "./[eventId]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/:eventId", eventId_Router);

export default openapi;
