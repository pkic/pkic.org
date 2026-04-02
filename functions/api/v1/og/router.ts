import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as OgCodeGet_l } from "./[code]";
import donation_Router from "./donation/router";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/:code", OgCodeGet_l);
app.route("/donation", donation_Router);

export default app;
