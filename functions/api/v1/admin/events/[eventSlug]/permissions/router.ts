import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestDelete as AdminEventsEventSlugPermissionsPermIdDelete_l } from "./[permId]";

const app = new Hono();
export const openapi = fromHono(app);

app.delete("/:permId", AdminEventsEventSlugPermissionsPermIdDelete_l);

export default app;
