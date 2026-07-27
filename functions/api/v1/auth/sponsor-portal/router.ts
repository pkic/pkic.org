import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as SponsorPortalRequestLinkPost_l } from "./request-link";
import { onRequestPost as SponsorPortalVerifyLinkPost_l } from "./verify-link";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/request-link", SponsorPortalRequestLinkPost_l);
app.post("/verify-link", SponsorPortalVerifyLinkPost_l);

export default openapi;
