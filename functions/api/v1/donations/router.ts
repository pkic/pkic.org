import { Hono } from "hono";
import { fromHono } from "chanfana";
import { DonationsCheckoutPost } from "./checkout";
import { DonationsStripeWebhookPost } from "./payments/stripe/webhook";
import { DonationsSessionGet } from "./session";
import { DonationDetailGet } from "./[id]";
import { DonationsList } from "./index";
import { DonationPromotersCreate, DonationPromotersList } from "./promoters";
import { DonationsSyncPost } from "./sync";
import { onRequestGet as DonationCheckoutBadgeGet } from "./checkouts/[sessionId]/badge";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/checkout", DonationsCheckoutPost);
// Keep provider callbacks under the owning donation resource and before the
// dynamic /:id route below.
openapi.post("/payments/stripe/webhook", DonationsStripeWebhookPost);
openapi.post("/promoters", DonationPromotersCreate);
openapi.get("/promoters", DonationPromotersList);
openapi.get("/session", DonationsSessionGet);
openapi.post("/sync", DonationsSyncPost);
app.get("/checkouts/:sessionId/badge", DonationCheckoutBadgeGet);
openapi.get("/", DonationsList);
openapi.get("/:id", DonationDetailGet);

export default openapi;
