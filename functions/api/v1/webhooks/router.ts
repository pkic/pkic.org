import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WebhooksStripePost } from "./stripe";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/stripe", WebhooksStripePost);

export default app;
