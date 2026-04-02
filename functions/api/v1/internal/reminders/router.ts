import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as InternalRemindersRunPost_l } from "./run";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/run", InternalRemindersRunPost_l);

export default app;
