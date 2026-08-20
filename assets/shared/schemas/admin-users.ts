/**
 * GET /api/v1/admin/users — query/response contract (P6M-P2-08: the route
 * previously predated chanfana/OpenAPIRoute for this endpoint and parsed its
 * query params by hand with a manual `new URL()`; now converged onto the
 * shared `openApiRoute`/`paginationQuerySchema` pattern every other admin
 * list endpoint uses, e.g. `admin-organizations.ts`).
 */
import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/** Allowlisted sort columns for GET /api/v1/admin/users — unqualified, matching the route's SELECT-list aliases. */
export const ADMIN_USERS_SORT_COLUMNS = ["last_name", "email", "organization_name", "role", "created_at"] as const;

/**
 * GET /api/v1/admin/users `type` filter — computed from the existing
 * `members`/`event_participants` tables ("Users Page — Member
 * vs. Event-Attendee Type Filter"), not a stored column.
 */
export const ADMIN_USERS_TYPE_VALUES = ["member", "event_attendee", "contact_only"] as const;

export const usersTypeValueSchema = z.enum(ADMIN_USERS_TYPE_VALUES).optional();

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const usersListQuerySchema = listQuerySchema(ADMIN_USERS_SORT_COLUMNS).extend({
  // `role` is a passthrough filter against users.role — never validated
  // against a fixed vocabulary by the pre-chanfana handler (unlike `type`
  // below), so an unrecognized value simply matches zero rows rather than
  // 400ing; preserved as-is rather than tightened into an enum here.
  role: trimmedString(1, 100).optional(),
  type: usersTypeValueSchema,
});

export const adminUserMembershipSchema = z.object({
  memberId: z.string(),
  membershipCategory: z.string().nullable(),
  status: z.string().nullable(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
});
export type AdminUserMembership = z.infer<typeof adminUserMembershipSchema>;

export const adminUserListItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  organization_name: z.string().nullable(),
  role: z.string(),
  active: z.number(),
  created_at: z.string(),
  member_id: z.string().nullable(),
  member_category: z.string().nullable(),
  member_status: z.string().nullable(),
  member_organization_id: z.string().nullable(),
  member_organization_name: z.string().nullable(),
  links: z.array(z.string()),
  membership: adminUserMembershipSchema.nullable(),
  type: z.enum(ADMIN_USERS_TYPE_VALUES),
  eventParticipationCount: z.number(),
});
export type AdminUserListItem = z.infer<typeof adminUserListItemSchema>;

export const usersListResponseSchema = paginatedResponseSchema("users", adminUserListItemSchema);

export const usersListRouteSchema = {
  tags: ["Users"],
  summary: "List users (admin)",
  description:
    "Paginated, filterable list of users for the admin console's user management section. Supports filtering by role, computed membership type, and a free-text email/name search.",
  request: { query: usersListQuerySchema },
  responses: {
    "200": {
      description: "Users list.",
      content: { "application/json": { schema: usersListResponseSchema } },
    },
  },
};
