import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as InternalRetentionRunPost_l } from "./run";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/run", InternalRetentionRunPost_l);

export default app;
