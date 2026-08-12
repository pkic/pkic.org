/**
 * GET /api/v1/admin/users sort support. The route itself
 * (functions/api/v1/admin/users.ts) predates chanfana/OpenAPIRoute for this
 * endpoint and still parses its other query params by hand, so this file
 * only carries the `sort` allowlist/schema rather than a full route schema.
 */
import { z } from "zod";

/** Allowlisted sort columns for GET /api/v1/admin/users — unqualified, matching the route's SELECT-list aliases. */
export const ADMIN_USERS_SORT_COLUMNS = ["last_name", "email", "organization_name", "role", "created_at"] as const;

export const usersSortValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(41)
  .refine(
    (value) => {
      const field = value.startsWith("-") ? value.slice(1) : value;
      return (ADMIN_USERS_SORT_COLUMNS as readonly string[]).includes(field);
    },
    { message: "Unknown sort column" },
  )
  .optional();

/**
 * GET /api/v1/admin/users `type` filter — computed from the existing
 * `members`/`event_participants` tables ("Users Page — Member
 * vs. Event-Attendee Type Filter"), not a stored column.
 */
export const ADMIN_USERS_TYPE_VALUES = ["member", "event_attendee", "contact_only"] as const;

export const usersTypeValueSchema = z.enum(ADMIN_USERS_TYPE_VALUES).optional();
