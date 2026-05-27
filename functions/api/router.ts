import { Hono } from "hono";
import { fromHono } from "chanfana";
import mcp_Router from "./mcp/router";
import v1_Router from "./v1/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/mcp", mcp_Router);
app.route("/v1", v1_Router);

export default app;
