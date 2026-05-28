import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailOutboxGet } from "./outbox";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/outbox", AdminEmailOutboxGet);

export default openapi;
