import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsSyncFromHugoPost_l } from "./sync-from-hugo";
import eventSlug_Router from "./[eventSlug]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/sync-from-hugo", AdminEventsSyncFromHugoPost_l);
app.route("/:eventSlug", eventSlug_Router);

export default app;
