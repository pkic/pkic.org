import { Hono } from "hono";
import { fromHono } from "chanfana";
import eventSlug_Router from "./[eventSlug]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/:eventSlug", eventSlug_Router);

export default openapi;
