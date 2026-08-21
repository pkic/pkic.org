import { Hono } from "hono";
import { fromHono } from "chanfana";
import { DonationsCheckoutPost } from "./checkout";
import { DonationsPromoterPost } from "./promoter";
import { DonationsSessionGet } from "./session";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/checkout", DonationsCheckoutPost);
openapi.post("/promoter", DonationsPromoterPost);
openapi.get("/session", DonationsSessionGet);

export default openapi;
