import { z } from "zod";

/** Allowlisted sort columns for GET /api/v1/admin/donations — see functions/api/v1/admin/donations.ts. */
export const ADMIN_DONATIONS_SORT_COLUMNS = ["name", "gross_amount", "status", "created_at"] as const;

export const donationsSortValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(41)
  .refine(
    (value) => {
      const field = value.startsWith("-") ? value.slice(1) : value;
      return (ADMIN_DONATIONS_SORT_COLUMNS as readonly string[]).includes(field);
    },
    { message: "Unknown sort column" },
  )
  .optional();
