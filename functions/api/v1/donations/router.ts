import { Hono } from "hono";
import { fromHono } from "chanfana";
import { DonationsCheckoutPost } from "./checkout";
import { DonationsPromoterPost } from "./promoter";
import { DonationsSessionGet } from "./session";
import { DonationDetailGet } from "./[id]";
import { DonationsList } from "./index";
import { DonationPromotersList } from "./promoters";
import { DonationsSyncPost } from "./sync";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/checkout", DonationsCheckoutPost);
openapi.post("/promoter", DonationsPromoterPost);
openapi.get("/promoters", DonationPromotersList);
openapi.get("/session", DonationsSessionGet);
openapi.post("/sync", DonationsSyncPost);
openapi.get("/", DonationsList);
openapi.get("/:id", DonationDetailGet);

export default openapi;
