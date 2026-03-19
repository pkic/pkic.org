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

export type DonationCheckoutInput = z.infer<typeof donationCheckoutSchema>;
