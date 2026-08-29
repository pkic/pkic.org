import { Hono } from "hono";
import { fromHono } from "chanfana";
import { CalendarRsvpPost } from "./rsvp";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/rsvp", CalendarRsvpPost);

export default openapi;
