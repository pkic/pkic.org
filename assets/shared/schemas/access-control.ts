/**
 * Access-control admin API schemas: permission_grants
 * ("access grants"), roles, and user_roles (role assignment).
 */
import { z } from "zod";
import { trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { permissionSchema } from "./permissions";

export const authorizationContextTypeSchema = z.enum(["event", "group", "organization"]);

/** Stable identifiers for system roles seeded by the membership migration. */
export const SYSTEM_ROLE_IDS = {
  groupLead: "role-group_lead",
  groupDeputyLead: "role-group_deputy_lead",
} as const;

export const accessGrantIdParamsSchema = z.object({ id: databaseIdSchema });
// Role ids are NOT always UUIDs — custom roles get a real uuid() (see
// roles/index.ts's RolesCreate), but every built-in/system role ships with
// a fixed human-readable id (role-admin, role-group_lead, and similar;
// see consolidated migration 0035). UUID-only validation here previously
// rejected every
// attempt to reference a system role by id (assign it via POST .../roles,
// or look up its holders via GET .../roles/:id/assignments) with a 400
// before the handler ever ran. Reused everywhere a role id appears — params,
// request bodies, and response payloads alike — so none of them drift
// back to UUID-only validation individually.
export const roleIdSchema = trimmedString(1, 80);
export const roleIdParamsSchema = z.object({ id: roleIdSchema });
export const userIdRolesParamsSchema = z.object({ userId: databaseIdSchema });
export const userRoleIdParamsSchema = z.object({ userId: databaseIdSchema, userRoleId: databaseIdSchema });

const scopedContextFields = {
  contextType: authorizationContextTypeSchema.nullable().optional(),
  contextId: trimmedString(1, 80).nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
};

function validateScopedContext(
  value: { contextType?: string | null; contextId?: string | null },
  ctx: z.core.$RefinementCtx,
): void {
  if (Boolean(value.contextType) !== Boolean(value.contextId)) {
    ctx.addIssue({
      code: "custom",
      message: "contextType and contextId must both be set, or both omitted",
      path: ["contextId"],
      input: value,
    });
  }
}

export const accessGrantCreateSchema = z
  .object({
    userId: databaseIdSchema,
    permission: permissionSchema,
    ...scopedContextFields,
  })
  .superRefine(validateScopedContext);
export type AccessGrantCreateInput = z.infer<typeof accessGrantCreateSchema>;

export const accessGrantResponseSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  userEmail: z.email(),
  permission: permissionSchema,
  contextType: authorizationContextTypeSchema.nullable(),
  contextId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AccessGrant = z.infer<typeof accessGrantResponseSchema>;
export const accessGrantCreateResponseSchema = z.object({ grant: accessGrantResponseSchema });

// Implements permission_grants.
export const accessGrantsCreateRouteSchema = {
  tags: ["Access Control"],
  summary: "Create a permission grant",
  description: "Grants a single permission to a user, optionally scoped and time-bounded.",
  request: {
    body: { content: { "application/json": { schema: accessGrantCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Grant created.",
      content: { "application/json": { schema: accessGrantCreateResponseSchema } },
    },
    "403": { description: "Missing access:grant permission." },
  },
};

/** Allowlisted sort columns for GET /api/v1/admin/access-grants — see permission_grants' access-grants/index.ts. */
export const ADMIN_ACCESS_GRANTS_SORT_COLUMNS = [
  "user_id",
  "permission",
  "context_type",
  "expires_at",
  "created_at",
] as const;

export const accessGrantsListQuerySchema = listQuerySchema(ADMIN_ACCESS_GRANTS_SORT_COLUMNS).extend({
  userId: databaseIdSchema.optional(),
});
export type AccessGrantsListQuery = z.infer<typeof accessGrantsListQuerySchema>;
export const accessGrantsListResponseSchema = paginatedResponseSchema("grants", accessGrantResponseSchema);

export const accessGrantsListRouteSchema = {
  tags: ["Access Control"],
  summary: "List permission grants",
  request: { query: accessGrantsListQuerySchema },
  responses: {
    "200": {
      description: "Active grants.",
      content: { "application/json": { schema: accessGrantsListResponseSchema } },
    },
  },
};

export const accessGrantRevokeRouteSchema = {
  tags: ["Access Control"],
  summary: "Revoke a permission grant",
  request: { params: accessGrantIdParamsSchema },
  responses: {
    "200": { description: "Grant revoked." },
    "404": { description: "Grant not found." },
  },
};

export const roleCreateSchema = z.object({
  name: trimmedString(1, 80).regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only"),
  description: trimmedString(0, 400).optional(),
  permissions: z.array(permissionSchema).max(64).default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleResponseSchema = z.object({
  id: roleIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  isSystemRole: z.boolean(),
  permissions: z.array(permissionSchema),
  createdAt: z.string(),
});
export type Role = z.infer<typeof roleResponseSchema>;
export const roleResponseEnvelopeSchema = z.object({ role: roleResponseSchema });

export const rolesCreateRouteSchema = {
  tags: ["Access Control"],
  summary: "Create a custom role",
  description: "Custom roles bundle permissions that can be assigned via user_roles.",
  request: {
    body: { content: { "application/json": { schema: roleCreateSchema } }, required: true },
  },
  responses: {
    "201": { description: "Role created.", content: { "application/json": { schema: roleResponseEnvelopeSchema } } },
    "409": { description: "A role with this name already exists." },
  },
};

/** Allowlisted sort columns for GET /api/v1/admin/roles — see roles/index.ts. */
export const ADMIN_ROLES_SORT_COLUMNS = ["name", "description"] as const;

export const rolesListQuerySchema = listQuerySchema(ADMIN_ROLES_SORT_COLUMNS);
export type RolesListQuery = z.infer<typeof rolesListQuerySchema>;
export const rolesListResponseSchema = paginatedResponseSchema("roles", roleResponseSchema);

export const rolesListRouteSchema = {
  tags: ["Access Control"],
  summary: "List roles",
  request: { query: rolesListQuerySchema },
  responses: {
    "200": {
      description: "All roles with their permission bundles.",
      content: { "application/json": { schema: rolesListResponseSchema } },
    },
  },
};

export const roleDeleteRouteSchema = {
  tags: ["Access Control"],
  summary: "Delete a custom role",
  request: { params: roleIdParamsSchema },
  responses: {
    "200": { description: "Role deleted." },
    "404": { description: "Role not found." },
    "409": { description: "System roles and roles with assignment history cannot be deleted." },
  },
};

/** Context and lifecycle fields shared by every user-role assignment projection. */
export const roleAssignmentContextSchema = z.object({
  contextType: authorizationContextTypeSchema.nullable(),
  contextId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const roleAssignmentSchema = roleAssignmentContextSchema.extend({
  userRoleId: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string(),
});

export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

export const ADMIN_ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS = [
  "name",
  "email",
  "context_type",
  "context_id",
  "expires_at",
  "created_at",
] as const;

export const roleAssignmentsListQuerySchema = listQuerySchema(ADMIN_ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS, {
  limit: 25,
});
export type RoleAssignmentsListQuery = z.infer<typeof roleAssignmentsListQuerySchema>;
export const roleAssignmentsListResponseSchema = paginatedResponseSchema("assignments", roleAssignmentSchema);

export const roleAssignmentsListRouteSchema = {
  tags: ["Access Control"],
  summary: "List every active holder of a role",
  description:
    "Reverse lookup of user_roles by role — who currently holds this role, and in which context. Powers admin " +
    "screens that need to show a role's current holders without already knowing the user.",
  request: { params: roleIdParamsSchema, query: roleAssignmentsListQuerySchema },
  responses: {
    "200": {
      description: "Active assignments of this role.",
      content: { "application/json": { schema: roleAssignmentsListResponseSchema } },
    },
    "404": { description: "Role not found." },
  },
};

export const userRoleAssignSchema = z
  .object({
    roleId: roleIdSchema,
    ...scopedContextFields,
  })
  .superRefine(validateScopedContext);
export type UserRoleAssignInput = z.infer<typeof userRoleAssignSchema>;

export const userRoleResponseSchema = roleAssignmentContextSchema.extend({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  roleId: roleIdSchema,
  roleName: z.string(),
});

export type UserRoleAssignment = z.infer<typeof userRoleResponseSchema>;
/** Response envelope returned by role assignment and expiry-update commands. */
export const userRoleResponseEnvelopeSchema = z.object({ role: userRoleResponseSchema });
export type UserRoleResponseEnvelope = z.infer<typeof userRoleResponseEnvelopeSchema>;

export const ADMIN_USER_ROLE_ASSIGNMENTS_SORT_COLUMNS = [
  "role_name",
  "context_type",
  "context_id",
  "expires_at",
  "created_at",
] as const;

export const userRolesListQuerySchema = listQuerySchema(ADMIN_USER_ROLE_ASSIGNMENTS_SORT_COLUMNS, { limit: 25 });
export type UserRolesListQuery = z.infer<typeof userRolesListQuerySchema>;
export const userRolesListResponseSchema = paginatedResponseSchema("roles", userRoleResponseSchema);

export const userRolesAssignRouteSchema = {
  tags: ["Access Control"],
  summary: "Assign a role to a user",
  description: "user_roles — a user may hold multiple roles simultaneously, optionally context-scoped.",
  request: {
    params: userIdRolesParamsSchema,
    body: { content: { "application/json": { schema: userRoleAssignSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Role assigned.",
      content: { "application/json": { schema: userRoleResponseEnvelopeSchema } },
    },
  },
};

export const userRolesListRouteSchema = {
  tags: ["Access Control"],
  summary: "List a user's non-revoked role assignments",
  description:
    "Includes expired assignments so administrators can inspect or extend completed terms; runtime authorization ignores them.",
  request: { params: userIdRolesParamsSchema, query: userRolesListQuerySchema },
  responses: {
    "200": {
      description: "Non-revoked role assignments, including expired terms.",
      content: { "application/json": { schema: userRolesListResponseSchema } },
    },
  },
};

export const userRoleRevokeRouteSchema = {
  tags: ["Access Control"],
  summary: "Revoke a user's role assignment",
  request: { params: userRoleIdParamsSchema },
  responses: {
    "200": { description: "Role assignment revoked." },
    "404": { description: "Assignment not found." },
  },
};

export const userRoleUpdateExpirySchema = z.object({
  // Explicit null clears the expiry (no term end); omitting the field is
  // not allowed — PATCH always states the intended value.
  expiresAt: z.iso.datetime().nullable(),
});
export type UserRoleUpdateExpiryInput = z.infer<typeof userRoleUpdateExpirySchema>;

export const userRoleUpdateExpiryRouteSchema = {
  tags: ["Access Control"],
  summary: "Change a role assignment's expiry date",
  description:
    "Updates user_roles.expires_at on an existing (non-revoked) assignment — e.g. a chair or vice-chair term " +
    "that had no expiry set, or one whose term end is being changed. Does not affect revoked_at.",
  request: {
    params: userRoleIdParamsSchema,
    body: { content: { "application/json": { schema: userRoleUpdateExpirySchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Expiry updated.",
      content: { "application/json": { schema: userRoleResponseEnvelopeSchema } },
    },
    "404": { description: "Assignment not found." },
  },
};
