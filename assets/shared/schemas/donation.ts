import { z } from "zod";
import { SUPPORTED_CURRENCY_CODES } from "../constants/currencies";

/**
 * Schema for POST /api/v1/donations/checkout — creates a Stripe Checkout Session.
 */
export const donationCheckoutSchema = z.object({
  /** Amount in the currency's smallest unit (cents for USD/EUR, whole units for JPY). */
  amount: z.number().int().positive().min(100).max(100_000_000),
  /** ISO 4217 currency code, lowercase. */
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .refine((c) => SUPPORTED_CURRENCY_CODES.has(c), "Unsupported currency"),
  /** Donor's full name (required for tax records). */
  name: z.string().trim().min(1, "Name is required").max(200),
  /** Donor's email — pre-fills Stripe Checkout and stored for tax reporting. */
  email: z.email().trim().toLowerCase().optional(),
  /** Donor's organisation name (optional). */
  organizationName: z.string().trim().max(200).optional(),
  /** Relative path to redirect to after successful donation (must start with /). */
  successPath: z
    .string()
    .trim()
    .max(500)
    .refine((p) => p.startsWith("/"), "Must be a relative path starting with /")
    .refine((p) => !p.includes("//"), "Must not contain //")
    .optional(),
  /** Relative path to redirect to if the donor cancels. */
  cancelPath: z
    .string()
    .trim()
    .max(500)
    .refine((p) => p.startsWith("/"), "Must be a relative path starting with /")
    .refine((p) => !p.includes("//"), "Must not contain //")
    .optional(),
  /** Optional metadata for tracking donation source. */
  metadata: z
    .object({
      /** URL path or label indicating where the donation was initiated. */
      source: z.string().trim().max(500).optional(),
    })
    .optional(),
  /** When true, creates a Stripe Embedded Checkout session (returns clientSecret). */
  embedded: z.boolean().optional(),
});

export const donationPromoterRequestSchema = z.object({
  session_id: z
    .string()
    .trim()
    .refine((value) => value.startsWith("cs_"), "Must be a valid Stripe checkout session ID")
    .describe("A valid completed Stripe checkout session ID starting with cs_"),
});

export const donationPromoterResponseSchema = z.object({
  code: z.string().describe("Uniquely generated promoter code"),
  shareUrl: z.string().url().describe("The URL where users can visit the share landing page"),
  ogImageUrl: z.string().url().describe("The dynamically generated image URL representing the donation badge"),
});

export const donationPromoterPostRouteSchema = {
  tags: ["Donations"],
  summary: "Create or retrieve promoter link",
  description:
    "Generates a unique social share link for a completed donation. The link points back to the donation page and includes an Open Graph social card preview badge.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: donationPromoterRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Promoter share link generated successfully.",
      content: {
        "application/json": {
          schema: donationPromoterResponseSchema,
        },
      },
    },
    "400": {
      description: "Invalid request body or Stripe session ID format.",
    },
    "404": {
      description: "Completed donation not found for the provided session ID.",
    },
    "500": {
      description: "Internal server error while reserving a unique code identifier.",
    },
  },
};

export const donationSessionQuerySchema = z.object({
  session_id: z
    .string()
    .trim()
    .refine((value) => value.startsWith("cs_"), "Must be a valid Stripe checkout session ID")
    .describe("The Stripe Checkout Session ID appended to the success redirect URL"),
});

export const donationSessionCompletedResponseSchema = z.object({
  grossAmount: z.number().describe("Gross donation amount (e.g. in cents)"),
  currency: z.string().describe("Three-letter ISO currency code"),
  donorFirstName: z.string().nullable().describe("Given or first name of the donor"),
  source: z.string().nullable().describe("The attribution or referral source code"),
  completedAt: z.string().describe("ISO-8601 timestamp representing checkout completion"),
});

export const donationSessionFailedResponseSchema = z.object({
  failed: z.literal(true),
});

export const donationSessionExpiredResponseSchema = z.object({
  expired: z.literal(true),
});

export const donationSessionResponseSchema = z.union([
  donationSessionCompletedResponseSchema,
  donationSessionFailedResponseSchema,
  donationSessionExpiredResponseSchema,
]);

export const donationSessionPendingResponseSchema = z.object({
  pending: z.literal(true),
  asyncPayment: z.boolean().optional(),
  paymentMethodType: z.string().nullable().optional(),
  sessionExpiresAt: z.number().nullable().optional(),
});

export const donationSessionGetRouteSchema = {
  tags: ["Donations"],
  summary: "Get minimal public donation information",
  description:
    "Returns public-safe metadata required to render thank-you badges for a given Stripe Checkout Session ID, intentionally omitting PII such as email/address.",
  request: {
    query: donationSessionQuerySchema,
  },
  responses: {
    "200": {
      description: "Public-safe completed donation data.",
      content: {
        "application/json": {
          schema: donationSessionResponseSchema,
        },
      },
    },
    "202": {
      description:
        "The donation is currently processing, or awaiting async payment settlement (e.g. bank transfer/ACH).",
      content: {
        "application/json": {
          schema: donationSessionPendingResponseSchema,
        },
      },
    },
    "400": {
      description: "Invalid session_id query parameter form.",
    },
  },
};

export type DonationCheckoutInput = z.infer<typeof donationCheckoutSchema>;
