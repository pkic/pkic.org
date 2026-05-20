import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsSyncFromHugoPost_l } from "./sync-from-hugo";
import eventSlug_Router from "./[eventSlug]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/sync-from-hugo", AdminEventsSyncFromHugoPost_l);
app.route("/:eventSlug", eventSlug_Router);

export default app;
