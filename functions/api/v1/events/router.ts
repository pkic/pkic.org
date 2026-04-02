import { Hono } from "hono";
import { fromHono } from "chanfana";
import eventSlug_Router from "./[eventSlug]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/:eventSlug", eventSlug_Router);

export default app;
