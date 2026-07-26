import { Hono } from "hono";
import { fromHono } from "chanfana";
import { SponsorshipCheckoutPost } from "./index";
import { SponsorshipCheckoutWebhookPost } from "./webhook";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/", SponsorshipCheckoutPost);
openapi.post("/webhook", SponsorshipCheckoutWebhookPost);

export default openapi;
