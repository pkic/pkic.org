import { z } from "zod";
import { stripeEventEnvelopeSchema, stripeIdentifierSchema } from "./stripe";
import { stripeCheckoutSessionSchema, stripeWebhookPostRouteSchema } from "./donation-webhook";
import { databaseIdSchema } from "./identifiers";
export const membershipPaymentEventSchema = stripeEventEnvelopeSchema.extend({
  id: stripeIdentifierSchema,
  created: z.number().int().nonnegative(),
});
export const membershipPaymentSessionSchema = stripeCheckoutSessionSchema.extend({
  metadata: z.object({
    membershipFeeId: databaseIdSchema,
    membershipCheckoutId: databaseIdSchema,
    applicationId: databaseIdSchema,
    workflowVersionId: databaseIdSchema,
    categoryCode: z.string(),
    generation: z.string(),
  }),
});
export const membershipPaymentWebhookRouteSchema = {
  ...stripeWebhookPostRouteSchema,
  tags: ["Membership"],
  summary: "Receive signed membership fee payment evidence",
  description: "Records verified membership fees against their pinned application requirements.",
  request: { body: { required: true, content: { "application/json": { schema: membershipPaymentEventSchema } } } },
};

export const membershipPaymentAdjustmentSchema = z.object({
  payment_intent: z.string().nullable().optional(),
  metadata: z.object({ membershipFeeId: z.string().optional() }).optional(),
});
