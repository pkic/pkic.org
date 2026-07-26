import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as MemberAuthRequestLinkPost_l } from "./request-link";
import { onRequestPost as MemberAuthVerifyLinkPost_l } from "./verify-link";
import { onRequestPost as MemberAuthLogoutPost_l } from "./logout";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/request-link", MemberAuthRequestLinkPost_l);
app.post("/verify-link", MemberAuthVerifyLinkPost_l);
app.post("/logout", MemberAuthLogoutPost_l);

export default openapi;
