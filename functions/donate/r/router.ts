import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequest as middleware_l } from "./_middleware";
import { onRequestGet } from "./[code]";

const app = new Hono();
export const openapi = fromHono(app);

app.use("*", middleware_l);
app.get("/:code", onRequestGet);

export default openapi;
