import { Hono } from "hono";
import { fromHono } from "chanfana";
import v1_Router from "./v1/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/v1", v1_Router);

export default app;
