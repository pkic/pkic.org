import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestDelete as AdminEventsEventSlugPermissionsPermIdDelete_l } from "./[permId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.delete("/:permId", AdminEventsEventSlugPermissionsPermIdDelete_l);

export default app;
