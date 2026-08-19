import { Hono } from "hono";
import { fromHono } from "chanfana";
import { DonationsList } from "../donations";
import { onRequestGet as AdminDonationsIdGet_l } from "./[id]";
import { DonationPromotersList } from "./promoters";
import { onRequestPost as AdminDonationsSyncPost_l } from "./sync";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", DonationsList);
openapi.get("/promoters", DonationPromotersList);
app.post("/sync", AdminDonationsSyncPost_l);
app.get("/:id", AdminDonationsIdGet_l);

export default openapi;
