import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as DonationsCheckoutPost_l } from "./checkout";
import { DonationsPromoterPost } from "./promoter";
import { DonationsSessionGet } from "./session";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/checkout", DonationsCheckoutPost_l);
openapi.post("/promoter", DonationsPromoterPost);
openapi.get("/session", DonationsSessionGet);

export default openapi;
