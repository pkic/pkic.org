import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsSyncFromHugoPost } from "./sync-from-hugo";
import eventSlug_Router from "./[eventSlug]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/sync-from-hugo", AdminEventsSyncFromHugoPost);
openapi.route("/:eventSlug", eventSlug_Router);

export default openapi;
