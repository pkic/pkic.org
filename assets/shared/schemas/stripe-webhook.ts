import { stripeEventEnvelopeSchema } from "./stripe";
import { publicOperation } from "./route-contract";

export const consolidatedStripeWebhookRouteSchema = {
  ...publicOperation(),
  tags: ["Payments"],
  summary: "Receive Stripe webhook events",
  description:
    "Verifies one Stripe endpoint signature and routes donation, sponsorship, and membership payment events to their owning workflow.",
  request: {
    body: {
      content: { "application/json": { schema: stripeEventEnvelopeSchema } },
      required: true,
    },
  },
  responses: {
    "200": { description: "Event processed or intentionally ignored." },
    "400": { description: "Missing or invalid signature, JSON, or domain payload." },
    "413": { description: "Webhook body exceeds the accepted byte limit." },
    "503": { description: "Stripe webhook secret is not configured." },
  },
};
