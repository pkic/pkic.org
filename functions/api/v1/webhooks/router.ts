import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WebhooksStripePost } from "./stripe";
import { WebhooksSendgridPost } from "./sendgrid";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/stripe", WebhooksStripePost);
openapi.post("/sendgrid", WebhooksSendgridPost);

export default openapi;
