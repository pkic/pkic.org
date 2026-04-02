import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugInvitesInviteIdResendPost_l } from "./resend";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/resend", AdminEventsEventSlugInvitesInviteIdResendPost_l);

export default app;
