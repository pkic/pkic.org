import { Hono } from "hono";
import { fromHono } from "chanfana";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/api", api_Router);
app.route("/donate", donate_Router);
app.route("/r", r_Router);

export default {
  fetch: app.fetch,
  //scheduled: async (batch, env) => {},
}