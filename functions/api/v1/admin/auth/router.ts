import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminAuthLogoutPost_l } from "./logout";
import { onRequestPost as AdminAuthRequestLinkPost_l } from "./request-link";
import { onRequestGet as AdminAuthSessionGet_l } from "./session";
import { onRequestPost as AdminAuthVerifyLinkPost_l } from "./verify-link";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/request-link", AdminAuthRequestLinkPost_l);
app.get("/session", AdminAuthSessionGet_l);
app.post("/logout", AdminAuthLogoutPost_l);
app.post("/verify-link", AdminAuthVerifyLinkPost_l);

export default openapi;
