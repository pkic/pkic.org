import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as InternalJobsRunPost_l } from "./run";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/run", InternalJobsRunPost_l);

export default openapi;
