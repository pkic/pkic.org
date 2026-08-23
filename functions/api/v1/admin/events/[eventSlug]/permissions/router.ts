import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEventsEventSlugPermissionsPermIdDelete } from "./[permId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.delete("/:permId", AdminEventsEventSlugPermissionsPermIdDelete);

export default openapi;
