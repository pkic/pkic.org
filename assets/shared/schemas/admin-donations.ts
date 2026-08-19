import { sortColumnSchema } from "./pagination";

/** Allowlisted sort columns for GET /api/v1/admin/donations — see functions/api/v1/admin/donations.ts. */
export const ADMIN_DONATIONS_SORT_COLUMNS = ["name", "gross_amount", "status", "created_at"] as const;

export const donationsSortValueSchema = sortColumnSchema(ADMIN_DONATIONS_SORT_COLUMNS);
