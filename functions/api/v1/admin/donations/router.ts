import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminDonationsIdGet_l } from "./[id]";
import { onRequestGet as AdminDonationsPromotersGet_l } from "./promoters";
import { onRequestPost as AdminDonationsSyncPost_l } from "./sync";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.get("/promoters", AdminDonationsPromotersGet_l);
app.post("/sync", AdminDonationsSyncPost_l);
app.get("/:id", AdminDonationsIdGet_l);

export default app;
