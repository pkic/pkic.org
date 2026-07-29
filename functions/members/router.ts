import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet } from "./[slug]";

const app = new Hono();
export const openapi = fromHono(app);

// Single catch-all — see [slug].ts's header comment for why a `/:slug`
// route pattern can't cover every legitimate request shape under
// `/members/*` (the bare directory page, nested static paths, etc.).
app.get("*", onRequestGet);

export default openapi;
