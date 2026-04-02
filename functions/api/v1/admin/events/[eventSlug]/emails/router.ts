import { Hono } from "hono";
import { fromHono } from "chanfana";
import campaign_Router from "./campaign/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/campaign", campaign_Router);

export default app;
