/**
 * GET /api/v1/admin/users — query/response contract (P6M-P2-08: the route
 * previously predated chanfana/OpenAPIRoute for this endpoint and parsed its
 * query params by hand with a manual `new URL()`; now converged onto the
 * shared `openApiRoute`/`paginationQuerySchema` pattern every other admin
 * list endpoint uses, e.g. `admin-organizations.ts`).
 */
import { z } from "zod";
import { trimmedString } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { membershipCategorySchema } from "./membership-categories";
import { linksSchema } from "./links";

export const adminRoleValueSchema = z.enum(["admin", "user", "guest"]);
export type AdminRoleValue = z.infer<typeof adminRoleValueSchema>;

export const adminUserUpdateSchema = z
  .object({
    role: adminRoleValueSchema.optional(),
    active: z.boolean().optional(),
    firstName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    preferredName: z.string().trim().max(80).nullable().optional(),
    organizationName: z.string().trim().max(200).nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    biography: z.string().trim().max(5000).nullable().optional(),
    links: linksSchema.nullable().optional(),
    isEcMember: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided",
  });

/** Allowlisted sort columns for GET /api/v1/admin/users — unqualified, matching the route's SELECT-list aliases. */
export const ADMIN_USERS_SORT_COLUMNS = ["last_name", "email", "organization_name", "role", "created_at"] as const;

/**
 * GET /api/v1/admin/users `type` filter — computed from membership and the
 * canonical participant-role source read model, not a stored column.
 */
export const ADMIN_USERS_TYPE_VALUES = ["member", "event_attendee", "contact_only"] as const;

export const usersTypeValueSchema = z.enum(ADMIN_USERS_TYPE_VALUES).optional();

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
  membershipCategory: membershipCategorySchema.nullable(),
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
  member_category: membershipCategorySchema.nullable(),
  member_status: z.string().nullable(),
  member_organization_id: z.string().nullable(),
  member_organization_name: z.string().nullable(),
  links: linksSchema,
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
