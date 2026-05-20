import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugWaitlistPromotePost_l } from "./promote";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/promote", AdminEventsEventSlugWaitlistPromotePost_l);

export default app;
