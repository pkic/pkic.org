import { z } from "zod";
import { eventIdSchema, normalizedEmailSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { stripeCurrencySchema, stripeEventEnvelopeSchema, stripeIdentifierSchema } from "./stripe";
import { httpUrlSchema, relativeRedirectPathSchema } from "./urls";

/** Schemas for /api/v1/sponsorship/*. */

export const sponsorshipInquirySchema = z.object({
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200),
  organizationWebsite: httpUrlSchema.optional(),
  desiredTier: z.string().trim().min(1).max(60),
  eventId: eventIdSchema.optional(),
  comments: z.string().trim().max(4000).optional(),
});

export type SponsorshipInquiryInput = z.infer<typeof sponsorshipInquirySchema>;

export const sponsorshipInquiryResponseSchema = z.object({
  sponsorshipId: databaseIdSchema,
  pipelineStage: z.literal("new_inquiry"),
});

export const sponsorshipInquiryRouteSchema = {
  tags: ["Sponsorship"],
  summary: "Submit sponsorship interest (Path A)",
  description:
    "Replaces POST /api/v1/forms (form_type=sponsor-interest). Creates a sponsorships record at pipeline_stage=new_inquiry and sends the sponsorship-brochure email.",
  request: {
    body: { content: { "application/json": { schema: sponsorshipInquirySchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Inquiry recorded.",
      content: { "application/json": { schema: sponsorshipInquiryResponseSchema } },
    },
    "422": { description: "Missing or invalid required fields." },
  },
};

export const sponsorshipCheckoutSchema = z.object({
  /** Stable for one browser checkout attempt so retries reuse one Stripe session. */
  checkoutAttemptId: z.uuid(),
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200).optional(),
  tier: z.string().trim().min(1).max(60),
  eventId: eventIdSchema,
  successPath: relativeRedirectPathSchema.optional(),
  cancelPath: relativeRedirectPathSchema.optional(),
});

export type SponsorshipCheckoutInput = z.infer<typeof sponsorshipCheckoutSchema>;

export const sponsorshipCheckoutWebhookEnvelopeSchema = stripeEventEnvelopeSchema.extend({
  id: stripeIdentifierSchema,
});

export const sponsorshipCheckoutSessionStatusSchema = z
  .object({
    id: stripeIdentifierSchema,
    object: z.literal("checkout.session"),
    payment_status: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .passthrough();

export const paidSponsorshipCheckoutSessionSchema = z
  .object({
    id: stripeIdentifierSchema,
    object: z.literal("checkout.session"),
    payment_status: z.literal("paid"),
    amount_total: z.number().int().positive(),
    currency: stripeCurrencySchema,
    metadata: z.object({
      checkout_attempt_id: z.uuid(),
      tier: z.string().trim().min(1).max(60),
      contact_name: z.string().trim().min(1).max(160),
      contact_email: normalizedEmailSchema,
      organization_name: z.string().trim().min(1).max(200).optional(),
      event_id: databaseIdSchema,
      event_slug: eventIdSchema,
      price_amount_cents: z.coerce.number().int().positive(),
      price_currency: stripeCurrencySchema,
    }),
  })
  .passthrough();

export type PaidSponsorshipCheckoutSession = z.infer<typeof paidSponsorshipCheckoutSessionSchema>;

export const sponsorshipCheckoutResponseSchema = z.object({
  url: httpUrlSchema,
});

export const sponsorshipCheckoutRouteSchema = {
  tags: ["Sponsorship"],
  summary: "Create a Stripe Checkout session for self-service event sponsorship (Path B)",
  description:
    "Uses the active event-tier price stored in D1 sponsorship configuration. Consortium sponsorship remains staff-managed.",
  request: {
    body: { content: { "application/json": { schema: sponsorshipCheckoutSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Checkout session created.",
      content: { "application/json": { schema: sponsorshipCheckoutResponseSchema } },
    },
    "422": { description: "Unknown tier or invalid fields." },
    "503": { description: "Stripe is not configured." },
  },
};

export const sponsorshipCheckoutWebhookRouteSchema = {
  tags: ["Sponsorship"],
  summary: "Stripe webhook for sponsorship checkout",
  description:
    "Verifies signature and, on checkout.session.completed, creates the sponsorships record at pipeline_stage=payment_pending.",
  responses: {
    "200": { description: "Event processed or acknowledged." },
    "400": { description: "Invalid signature or payload." },
    "413": { description: "Webhook body exceeds the accepted byte limit." },
    "503": { description: "Webhook secret not configured." },
  },
};
