import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet } from "./[slug]";

const app = new Hono();
export const openapi = fromHono(app);

// All member browsing resolves through the same static publication boundary.
app.get("*", onRequestGet);

export default openapi;
