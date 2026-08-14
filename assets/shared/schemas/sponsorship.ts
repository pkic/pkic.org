import { z } from "zod";
import { normalizedEmailSchema } from "./api";

/** Schemas for /api/v1/sponsorship/*. */

export const sponsorshipInquirySchema = z.object({
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200),
  organizationWebsite: z.url().optional(),
  desiredTier: z.string().trim().min(1).max(60),
  eventId: z.string().trim().min(1).max(80).optional(),
  comments: z.string().trim().max(4000).optional(),
});

export type SponsorshipInquiryInput = z.infer<typeof sponsorshipInquirySchema>;

export const sponsorshipInquiryResponseSchema = z.object({
  sponsorshipId: z.string(),
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
  contactName: z.string().trim().min(1).max(160),
  contactEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200).optional(),
  tier: z.string().trim().min(1).max(60),
  eventId: z.string().trim().min(1).max(80),
  successPath: z
    .string()
    .trim()
    .max(500)
    .refine((p) => p.startsWith("/"), "Must be a relative path starting with /")
    .refine((p) => !p.includes("//"), "Must not contain //")
    .optional(),
  cancelPath: z
    .string()
    .trim()
    .max(500)
    .refine((p) => p.startsWith("/"), "Must be a relative path starting with /")
    .refine((p) => !p.includes("//"), "Must not contain //")
    .optional(),
});

export type SponsorshipCheckoutInput = z.infer<typeof sponsorshipCheckoutSchema>;

export const sponsorshipCheckoutResponseSchema = z.object({
  url: z.string(),
});

export const sponsorshipCheckoutRouteSchema = {
  tags: ["Sponsorship"],
  summary: "Create a Stripe Checkout session for self-service event sponsorship (Path B)",
  description:
    "Scoped to event sponsorship tiers (Leader/Inspirator/Innovator/Ambassador) with a fixed price list — see functions/_lib/services/sponsorship.ts. Consortium sponsorship remains staff-managed.",
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
    "503": { description: "Webhook secret not configured." },
  },
};
