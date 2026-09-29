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
