import { z } from "zod";
import { stripeCheckoutSessionIdSchema, stripeCurrencySchema, stripeEventEnvelopeSchema } from "./stripe";
import { publicOperation } from "./route-contract";

export const stripeWebhookEnvelopeSchema = stripeEventEnvelopeSchema;

export const stripeCheckoutSessionSchema = z
  .object({
    id: stripeCheckoutSessionIdSchema,
    object: z.literal("checkout.session").optional(),
    status: z.enum(["open", "complete", "expired"]).optional(),
    payment_status: z.string().nullable().optional(),
    payment_intent: z.string().nullable(),
    payment_method_types: z.array(z.string()).nullable().optional(),
    expires_at: z.number().int().nullable().optional(),
    amount_total: z.number().int().nullable(),
    currency: stripeCurrencySchema,
    customer_email: z.string().nullable(),
    metadata: z.record(z.string(), z.string()).nullable().optional(),
    customer_details: z
      .object({ email: z.string().nullable().optional(), name: z.string().nullable().optional() })
      .nullable()
      .optional(),
  })
  .passthrough();

export const stripeWebhookPostRouteSchema = {
  ...publicOperation(),
  tags: ["Donations"],
  summary: "Receive Stripe webhook events",
  description:
    "Processes signed Stripe checkout and payment events for donations, status updates, and promoter code generation.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: stripeWebhookEnvelopeSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": { description: "Webhook accepted and processed or intentionally ignored." },
    "400": { description: "Missing/invalid signature or invalid JSON payload." },
    "413": { description: "Webhook body exceeds the accepted byte limit." },
    "503": { description: "Stripe webhook secret is not configured." },
  },
};
