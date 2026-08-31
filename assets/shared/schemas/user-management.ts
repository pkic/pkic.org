/**
 * GET /api/v1/users — query/response contract (P6M-P2-08: the route
 * previously predated chanfana/OpenAPIRoute for this endpoint and parsed its
 * query params by hand with a manual `new URL()`; now converged onto the
 * shared `openApiRoute`/`paginationQuerySchema` pattern used by every
 * canonical listing endpoint.
 */
import { z } from "zod";
import { userIdParamsSchema, successResponseSchema, trimmedString } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { memberStatusSchema, membershipCategorySchema } from "./membership-categories";
import { linksSchema } from "./links";
import { groupLabelSchema } from "./groups";
import { httpOrSameOriginUrlSchema } from "./urls";

export const userRoleValueSchema = z.enum(["admin", "user", "guest"]);
export type UserRoleValue = z.infer<typeof userRoleValueSchema>;

export const userUpdateSchema = z
  .object({
    role: userRoleValueSchema.optional(),
    active: z.boolean().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    firstName: z.string().trim().max(80).nullable().optional(),
    lastName: z.string().trim().max(120).nullable().optional(),
    preferredName: z.string().trim().max(80).nullable().optional(),
    organizationName: z.string().trim().max(200).nullable().optional(),
    jobTitle: z.string().trim().max(200).nullable().optional(),
    biography: z.string().trim().max(5000).nullable().optional(),
    links: linksSchema.nullable().optional(),
    isEcMember: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided",
  });

/** Allowlisted sort columns for GET /api/v1/users — unqualified, matching the route's SELECT-list aliases. */
export const USERS_SORT_COLUMNS = ["last_name", "email", "organization_name", "role", "created_at"] as const;

/**
 * GET /api/v1/users `type` filter — computed from membership and the
 * canonical participant-role source read model, not a stored column.
 */
export const USER_TYPE_VALUES = ["member", "event_attendee", "contact_only"] as const;

export const userTypeValueSchema = z.enum(USER_TYPE_VALUES).optional();

export const usersListQuerySchema = listQuerySchema(USERS_SORT_COLUMNS).extend({
  // `role` is a passthrough filter against users.role — never validated
  // against a fixed vocabulary by the pre-chanfana handler (unlike `type`
  // below), so an unrecognized value simply matches zero rows rather than
  // 400ing; preserved as-is rather than tightened into an enum here.
  role: trimmedString(1, 100).optional(),
  type: userTypeValueSchema,
});
export type UsersListQuery = z.infer<typeof usersListQuerySchema>;

export const userMembershipSchema = z.object({
  memberId: z.string(),
  membershipCategory: membershipCategorySchema.nullable(),
  status: memberStatusSchema.nullable(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
});
export type UserMembership = z.infer<typeof userMembershipSchema>;

const userResponseBaseSchema = z.object({
  id: z.string(),
  email: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  organization_name: z.string().nullable(),
  role: userRoleValueSchema,
  created_at: z.string(),
  links: linksSchema,
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
});

export const userListItemSchema = userResponseBaseSchema.extend({
  active: z.union([z.literal(0), z.literal(1)]),
  member_id: z.string().nullable(),
  member_category: membershipCategorySchema.nullable(),
  member_status: memberStatusSchema.nullable(),
  member_organization_id: z.string().nullable(),
  member_organization_name: z.string().nullable(),
  membership: userMembershipSchema.nullable(),
  type: z.enum(USER_TYPE_VALUES),
  eventParticipationCount: z.number(),
});
export type UserListItem = z.infer<typeof userListItemSchema>;

export const usersListResponseSchema = paginatedResponseSchema("users", userListItemSchema);

export const userMembershipDetailSchema = z.object({
  memberId: z.string(),
  membershipCategory: membershipCategorySchema,
  status: memberStatusSchema,
  showOnOrgProfile: z.boolean(),
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  emailId: z.string().nullable(),
  email: z.string().email(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  createdAt: z.string(),
  groups: z.array(groupLabelSchema),
});
export const userDetailSchema = userResponseBaseSchema.extend({
  preferred_name: z.string().nullable(),
  job_title: z.string().nullable(),
  biography: z.string().nullable(),
  active: z.boolean(),
  isEcMember: z.boolean(),
  updated_at: z.string(),
  pii_redacted_at: z.string().nullable(),
  memberships: z.array(userMembershipDetailSchema),
});
export const userDetailResponseSchema = z.object({ user: userDetailSchema });

export const userDetailRouteSchema = {
  tags: ["Users"],
  summary: "Get a user detail",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "User detail and capacity-specific group participation.",
      content: { "application/json": { schema: userDetailResponseSchema } },
    },
    "400": { description: "Invalid user identifier." },
    "401": { description: "Staff authorization required." },
    "404": { description: "User not found." },
  },
};
/** PATCH /api/v1/users/:userId keeps the command acknowledgement and returns the edited user. */
export const userUpdateResponseSchema = successResponseSchema.extend({
  user: userDetailSchema.pick({ id: true, email: true, role: true, active: true }).extend({
    isEcMember: z.boolean(),
  }),
});

export const usersListRouteSchema = {
  tags: ["Users"],
  summary: "List users",
  description:
    "Paginated, filterable user directory for staff. Supports filtering by role, computed membership type, and a free-text email/name search.",
  "x-pkic-auth": { required: true, scopes: ["users:read"] },
  request: { query: usersListQuerySchema },
  responses: {
    "200": {
      description: "Users list.",
      content: { "application/json": { schema: usersListResponseSchema } },
    },
  },
};

export const userUpdateRouteSchema = {
  tags: ["Users"],
  summary: "Update a user",
  description:
    "Updates profile fields with users:write. Changing the primary email address or legacy role additionally requires access:grant.",
  "x-pkic-auth": { required: true, scopes: ["users:write"] },
  request: {
    params: userIdParamsSchema,
    body: { content: { "application/json": { schema: userUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated user.", content: { "application/json": { schema: userUpdateResponseSchema } } },
    "400": { description: "Invalid user identifier or update body." },
    "401": { description: "Staff authorization required." },
    "403": { description: "User update permission required." },
    "404": { description: "User not found." },
    "409": { description: "The user or authorization changed while the update was being saved." },
  },
};

export const userAnonymizeResponseSchema = successResponseSchema.extend({
  userId: userIdParamsSchema.shape.userId,
});

export const userAnonymizeRouteSchema = {
  tags: ["Users"],
  summary: "Anonymize a user",
  description: "Irreversibly removes the user's personal data and revokes access paths.",
  "x-pkic-auth": { required: true, scopes: ["users:anonymize"] },
  request: { params: userIdParamsSchema },
  responses: {
    "200": {
      description: "User anonymized.",
      content: { "application/json": { schema: userAnonymizeResponseSchema } },
    },
    "401": { description: "Staff authorization required." },
    "403": { description: "The calling staff user cannot anonymize this account." },
    "404": { description: "User not found." },
    "409": { description: "The user is already anonymized or changed concurrently." },
  },
};
