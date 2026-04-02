import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminDonationsPromotersGet_l } from "./promoters";
import { onRequestPost as AdminDonationsSyncPost_l } from "./sync";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/promoters", AdminDonationsPromotersGet_l);
app.post("/sync", AdminDonationsSyncPost_l);

export default app;
