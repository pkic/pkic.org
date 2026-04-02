import { Hono } from "hono";
import { fromHono } from "chanfana";
import { InternalCalendarRsvpPost } from "./rsvp";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/rsvp", InternalCalendarRsvpPost);

export default app;
