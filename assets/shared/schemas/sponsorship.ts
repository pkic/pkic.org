import { z } from "zod";
import { eventIdSchema, normalizedEmailSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { stripeCurrencySchema, stripeEventEnvelopeSchema, stripeIdentifierSchema } from "./stripe";
import { httpUrlSchema, relativeRedirectPathSchema } from "./urls";

/** Shared public sponsor inquiry and checkout schemas. */

export const sponsorshipTypeSchema = z.enum(["consortium", "event"]);
export type SponsorshipType = z.infer<typeof sponsorshipTypeSchema>;

export const sponsorshipTierNameSchema = z.string().trim().min(1).max(60);

/**
 * The selected tier is an expression of interest, not a required commercial
 * commitment. `null` deliberately represents "not sure yet" so the public
 * form never needs a synthetic catalog value such as "Other".
 */
export const sponsorshipInquiryTierSchema = sponsorshipTierNameSchema.nullish().transform((tier) => tier ?? null);

export const sponsorshipInquirySchema = z.object({
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200),
  organizationWebsite: httpUrlSchema.optional(),
  tier: sponsorshipInquiryTierSchema,
  eventId: eventIdSchema.optional(),
  comments: z.string().trim().max(4000).optional(),
});

export type SponsorshipInquiryInput = z.infer<typeof sponsorshipInquirySchema>;

export const sponsorshipInquiryResponseSchema = z.object({
  sponsorshipId: databaseIdSchema,
  pipelineStage: z.literal("new_inquiry"),
});

export const sponsorshipTierSchema = z.object({
  tier: sponsorshipTierNameSchema,
});

export const sponsorshipTiersQuerySchema = z.object({
  sponsorType: sponsorshipTypeSchema.default("consortium"),
});
export type SponsorshipTiersQuery = z.infer<typeof sponsorshipTiersQuerySchema>;

export const sponsorshipTiersResponseSchema = z.object({
  sponsorType: sponsorshipTypeSchema,
  tiers: z.array(sponsorshipTierSchema),
});
export type SponsorshipTiersResponse = z.infer<typeof sponsorshipTiersResponseSchema>;

export const sponsorshipTiersRouteSchema = {
  tags: ["Sponsorship"],
  summary: "List active sponsorship tiers",
  description:
    "Returns the active D1-backed tier catalog for one sponsorship type. Public inquiry forms use this endpoint instead of duplicating tiers in browser code.",
  request: { query: sponsorshipTiersQuerySchema },
  responses: {
    "200": {
      description: "Active sponsorship tiers.",
      content: { "application/json": { schema: sponsorshipTiersResponseSchema } },
    },
  },
};

export const sponsorshipInquiryRouteSchema = {
  tags: ["Sponsorship"],
  summary: "Submit sponsorship interest (Path A)",
  description:
    "Creates a sponsorships record at pipeline_stage=new_inquiry and queues the sponsorship-brochure email through the durable outbox.",
  request: {
    body: { content: { "application/json": { schema: sponsorshipInquirySchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Inquiry recorded.",
      content: { "application/json": { schema: sponsorshipInquiryResponseSchema } },
    },
    "422": { description: "Unknown tier or invalid fields." },
  },
};

export const sponsorshipCheckoutSchema = z.object({
  /** Stable for one browser checkout attempt so retries reuse one Stripe session. */
  checkoutAttemptId: z.uuid(),
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200).optional(),
  tier: sponsorshipTierNameSchema,
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
      tier: sponsorshipTierNameSchema,
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
