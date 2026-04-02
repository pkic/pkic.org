import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugWaitlistPromotePost_l } from "./promote";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/promote", AdminEventsEventSlugWaitlistPromotePost_l);

export default app;
