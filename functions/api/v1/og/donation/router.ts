import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as OgDonationSessionIdGet_l } from "./[session_id]";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/:session_id", OgDonationSessionIdGet_l);

export default app;
