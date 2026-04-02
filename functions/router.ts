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

app.notFound(async (c: any) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  if (c.env.DEV_STATIC_ORIGIN) {
    const requestUrl = new URL(c.req.url);
    const staticUrl = new URL(c.env.DEV_STATIC_ORIGIN);

    staticUrl.pathname = requestUrl.pathname;
    staticUrl.search = requestUrl.search;

    return fetch(new Request(staticUrl.toString(), c.req.raw));
  }

  return c.json({ error: "Not Found" }, 404);
});

export default app;
