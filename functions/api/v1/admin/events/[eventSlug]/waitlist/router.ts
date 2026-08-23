import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugWaitlistPromotePost } from "./promote";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/promote", AdminEventsEventSlugWaitlistPromotePost);

export default openapi;
