import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailOutboxGet } from "./outbox";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/outbox", AdminEmailOutboxGet);

export default app;
