import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugInvitesSpeakersBulkPost_l } from "./bulk";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/bulk", AdminEventsEventSlugInvitesSpeakersBulkPost_l);

export default app;
