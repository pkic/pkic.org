import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugEmailsCampaignPreviewPost_l } from "./preview";
import { onRequestPost as AdminEventsEventSlugEmailsCampaignSendPost_l } from "./send";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/preview", AdminEventsEventSlugEmailsCampaignPreviewPost_l);
app.post("/send", AdminEventsEventSlugEmailsCampaignSendPost_l);

export default app;
