import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminAuthRequestLinkPost_l } from "./request-link";
import { onRequestPost as AdminAuthVerifyLinkPost_l } from "./verify-link";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/request-link", AdminAuthRequestLinkPost_l);
app.post("/verify-link", AdminAuthVerifyLinkPost_l);

export default app;
