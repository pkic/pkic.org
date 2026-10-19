import { z } from "zod";

export const stripeIdentifierSchema = z.string().trim().min(1).max(255);
export const stripeCheckoutSessionIdSchema = stripeIdentifierSchema.refine(
  (value) => value.startsWith("cs_"),
  "Must be a Stripe checkout session ID",
);
export const stripeCurrencySchema = z.string().regex(/^[a-z]{3}$/);

export const stripeEventEnvelopeSchema = z
  .object({
    id: stripeIdentifierSchema.optional(),
    type: z.string().trim().min(1).max(160),
    data: z.object({ object: z.unknown() }),
  })
  .passthrough();

/** Signed charge/dispute webhooks identify their previously recorded payment intent. */
export const stripePaymentAdjustmentObjectSchema = z
  .object({
    payment_intent: stripeIdentifierSchema,
  })
  .passthrough();
export const stripePaymentAdjustmentEventSchema = stripeEventEnvelopeSchema.extend({
  id: stripeIdentifierSchema,
  type: z.enum(["charge.refunded", "charge.dispute.created"]),
  data: z.object({ object: stripePaymentAdjustmentObjectSchema }),
});
