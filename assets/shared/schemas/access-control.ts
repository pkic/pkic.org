/**
 * Access-control System API schemas: permission_grants
 * ("access grants"), roles, and user_roles (role assignment).
 */
import { z } from "zod";
import { trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema, searchTermSchema } from "./pagination";
import { permissionSchema } from "./permissions";
import { userCatalogListQuerySchema, userCatalogListResponseSchema } from "./user-catalog";

export const authorizationContextTypeSchema = z.enum(["event", "group", "organization"]);

/** Stable identifiers for system roles seeded by the membership migration. */
export const SYSTEM_ROLE_IDS = {
  admin: "role-admin",
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
export const userRoleIdParamsSchema = z.object({
  userId: databaseIdSchema,
  userRoleId: databaseIdSchema,
});

const scopedContextFields = {
  contextType: authorizationContextTypeSchema.nullable().optional(),
  contextId: trimmedString(1, 80).nullable().optional(),
  expiresAt: utcInstantSchema.nullable().optional(),
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
export const accessGrantCreateResponseSchema = z.object({
  grant: accessGrantResponseSchema,
});

// Implements permission_grants.
export const accessGrantsCreateRouteSchema = {
  tags: ["Permissions"],
  summary: "Create a permission grant",
  description: "Grants a single permission to a user, optionally scoped and time-bounded.",
  "x-pkic-auth": { required: true, scopes: ["access:grant"] },
  request: {
    body: {
      content: { "application/json": { schema: accessGrantCreateSchema } },
      required: true,
    },
  },
  responses: {
    "201": {
      description: "Grant created.",
      content: {
        "application/json": { schema: accessGrantCreateResponseSchema },
      },
    },
    "403": { description: "Missing access:grant permission." },
  },
};

/** Allowlisted sort columns for the System permission-grant catalog. */
export const ACCESS_GRANTS_SORT_COLUMNS = [
  "user_id",
  "permission",
  "context_type",
  "expires_at",
  "created_at",
] as const;

export const accessGrantsListQuerySchema = listQuerySchema(ACCESS_GRANTS_SORT_COLUMNS).extend({
  userId: databaseIdSchema.optional(),
});
export type AccessGrantsListQuery = z.infer<typeof accessGrantsListQuerySchema>;
export const accessGrantsListResponseSchema = paginatedResponseSchema("grants", accessGrantResponseSchema);

export const accessGrantsListRouteSchema = {
  tags: ["Permissions"],
  summary: "List permission grants",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { query: accessGrantsListQuerySchema },
  responses: {
    "200": {
      description: "Non-revoked grants, including expired history.",
      content: {
        "application/json": { schema: accessGrantsListResponseSchema },
      },
    },
  },
};

export const accessGrantRevokeRouteSchema = {
  tags: ["Permissions"],
  summary: "Revoke a permission grant",
  "x-pkic-auth": { required: true, scopes: ["access:revoke"] },
  request: { params: accessGrantIdParamsSchema },
  responses: {
    "200": { description: "Grant revoked." },
    "404": { description: "Grant not found." },
  },
};

export const roleCreateSchema = z.object({
  name: trimmedString(1, 80, "Give the role a name.").regex(
    /^[a-z][a-z0-9_]*$/,
    "Use lowercase letters, numbers, and underscores only",
  ),
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
  /** `updated_at`; pass back as PATCH's `revision` to guard against a lost concurrent edit. */
  updatedAt: z.string(),
});
export type Role = z.infer<typeof roleResponseSchema>;
export const roleResponseEnvelopeSchema = z.object({
  role: roleResponseSchema,
});

export const rolesCreateRouteSchema = {
  tags: ["Roles"],
  summary: "Create a custom role",
  description: "Custom roles bundle permissions that can be assigned to users.",
  "x-pkic-auth": { required: true, scopes: ["access:grant"] },
  request: {
    body: {
      content: { "application/json": { schema: roleCreateSchema } },
      required: true,
    },
  },
  responses: {
    "201": {
      description: "Role created.",
      content: { "application/json": { schema: roleResponseEnvelopeSchema } },
    },
    "409": { description: "A role with this name already exists." },
  },
};

/** Allowlisted sort columns for the System role catalog. */
export const ROLES_SORT_COLUMNS = ["name", "description"] as const;

export const rolesListQuerySchema = listQuerySchema(ROLES_SORT_COLUMNS);
export type RolesListQuery = z.infer<typeof rolesListQuerySchema>;
export const rolesListResponseSchema = paginatedResponseSchema("roles", roleResponseSchema);

export const rolesListRouteSchema = {
  tags: ["Roles"],
  summary: "List roles",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { query: rolesListQuerySchema },
  responses: {
    "200": {
      description: "All roles with their permission bundles.",
      content: { "application/json": { schema: rolesListResponseSchema } },
    },
  },
};

export const roleDeleteRouteSchema = {
  tags: ["Roles"],
  summary: "Delete a custom role",
  "x-pkic-auth": { required: true, scopes: ["access:revoke"] },
  request: { params: roleIdParamsSchema },
  responses: {
    "200": { description: "Role deleted." },
    "404": { description: "Role not found." },
    "409": {
      description: "System roles and roles with assignment history cannot be deleted.",
    },
  },
};

export const roleGetRouteSchema = {
  tags: ["Roles"],
  summary: "Get a role",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { params: roleIdParamsSchema },
  responses: {
    "200": {
      description: "Role detail, including its current revision for editing.",
      content: { "application/json": { schema: roleResponseEnvelopeSchema } },
    },
    "404": { description: "Role not found." },
  },
};

export const roleUpdateSchema = z.object({
  name: trimmedString(1, 80)
    .regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only")
    .optional(),
  description: trimmedString(0, 400).nullable().optional(),
  permissions: z.array(permissionSchema).max(64).optional(),
  /** `updatedAt` from a prior GET; required to prevent lost concurrent edits. */
  revision: z.string().min(1).max(64),
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

export const roleUpdateRouteSchema = {
  tags: ["Roles"],
  summary: "Update a custom role",
  description: "Updates a custom role's name, description, or bundled permissions. System roles cannot be edited.",
  "x-pkic-auth": { required: true, scopes: ["access:grant"] },
  request: {
    params: roleIdParamsSchema,
    body: {
      content: { "application/json": { schema: roleUpdateSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Role updated.",
      content: { "application/json": { schema: roleResponseEnvelopeSchema } },
    },
    "404": { description: "Role not found." },
    "409": {
      description:
        "System roles cannot be edited; a role with this name already exists; or the role changed concurrently.",
    },
  },
};

/** Target and lifecycle fields shared by every user-role assignment projection. */
export const roleAssignmentTargetSchema = z.object({
  contextType: authorizationContextTypeSchema.nullable(),
  contextId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const roleAssignmentSchema = roleAssignmentTargetSchema.extend({
  userRoleId: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string(),
});

export type RoleAssignment = z.infer<typeof roleAssignmentSchema>;

export const ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS = [
  "name",
  "email",
  "context_type",
  "context_id",
  "expires_at",
  "created_at",
] as const;

export const roleAssignmentsListQuerySchema = listQuerySchema(ROLE_ASSIGNMENT_HOLDERS_SORT_COLUMNS, {
  limit: 25,
});
export type RoleAssignmentsListQuery = z.infer<typeof roleAssignmentsListQuerySchema>;
export const roleAssignmentsListResponseSchema = paginatedResponseSchema("assignments", roleAssignmentSchema);

export const roleAssignmentsListRouteSchema = {
  tags: ["Roles"],
  summary: "List every active holder of a role",
  description: "Reverse lookup of user roles by role — who currently holds this role and for which resource target.",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: {
    params: roleIdParamsSchema,
    query: roleAssignmentsListQuerySchema,
  },
  responses: {
    "200": {
      description: "Active assignments of this role.",
      content: {
        "application/json": { schema: roleAssignmentsListResponseSchema },
      },
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

export const userRoleResponseSchema = roleAssignmentTargetSchema.extend({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  roleId: roleIdSchema,
  roleName: z.string(),
});

export type UserRoleAssignment = z.infer<typeof userRoleResponseSchema>;
/** Response envelope returned by role assignment and expiry-update commands. */
export const userRoleResponseEnvelopeSchema = z.object({
  role: userRoleResponseSchema,
});
export type UserRoleResponseEnvelope = z.infer<typeof userRoleResponseEnvelopeSchema>;

export const USER_ROLE_ASSIGNMENTS_SORT_COLUMNS = [
  "role_name",
  "context_type",
  "context_id",
  "expires_at",
  "created_at",
] as const;

export const userRolesListQuerySchema = listQuerySchema(USER_ROLE_ASSIGNMENTS_SORT_COLUMNS, { limit: 25 });
export type UserRolesListQuery = z.infer<typeof userRolesListQuerySchema>;
export const userRolesListResponseSchema = paginatedResponseSchema("roles", userRoleResponseSchema);

export const userRolesAssignRouteSchema = {
  tags: ["Users"],
  summary: "Assign a role to a user",
  description:
    "Assigns a general system or custom role, optionally scoped to a resource target. Group lead and deputy lead assignments are managed through the target group's Leadership resource because they require an explicit active Member capacity.",
  "x-pkic-auth": { required: true, scopes: ["access:grant"] },
  request: {
    params: userIdRolesParamsSchema,
    body: {
      content: { "application/json": { schema: userRoleAssignSchema } },
      required: true,
    },
  },
  responses: {
    "201": {
      description: "Role assigned.",
      content: {
        "application/json": { schema: userRoleResponseEnvelopeSchema },
      },
    },
    "422": {
      description: "The role is owned by a resource-specific command, such as capacity-bound group leadership.",
    },
  },
};

export const userRolesListRouteSchema = {
  tags: ["Users"],
  summary: "List a user's non-revoked role assignments",
  description:
    "Includes expired assignments so administrators can inspect or extend completed terms; runtime authorization ignores them.",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { params: userIdRolesParamsSchema, query: userRolesListQuerySchema },
  responses: {
    "200": {
      description: "Non-revoked role assignments, including expired terms.",
      content: { "application/json": { schema: userRolesListResponseSchema } },
    },
  },
};

export const userRoleRevokeRouteSchema = {
  tags: ["Users"],
  summary: "Revoke a user's role assignment",
  "x-pkic-auth": { required: true, scopes: ["access:revoke"] },
  request: { params: userRoleIdParamsSchema },
  responses: {
    "200": { description: "Role assignment revoked." },
    "404": { description: "Assignment not found." },
  },
};

export const userRoleUpdateExpirySchema = z.object({
  // Explicit null clears the expiry (no term end); omitting the field is
  // not allowed — PATCH always states the intended value.
  expiresAt: utcInstantSchema.nullable(),
});
export type UserRoleUpdateExpiryInput = z.infer<typeof userRoleUpdateExpirySchema>;

export const userRoleUpdateExpiryRouteSchema = {
  tags: ["Users"],
  summary: "Change a role assignment's expiry date",
  description:
    "Updates user_roles.expires_at on an existing (non-revoked) assignment — e.g. a chair or vice-chair term " +
    "that had no expiry set, or one whose term end is being changed. Does not affect revoked_at.",
  "x-pkic-auth": { required: true, scopes: ["access:grant"] },
  request: {
    params: userRoleIdParamsSchema,
    body: {
      content: { "application/json": { schema: userRoleUpdateExpirySchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Expiry updated.",
      content: {
        "application/json": { schema: userRoleResponseEnvelopeSchema },
      },
    },
    "404": { description: "Assignment not found." },
  },
};

/** Bounded, data-minimized active-user search for permission assignments. */
export const permissionSubjectsListRouteSchema = {
  tags: ["Permissions"],
  summary: "Search active permission subjects",
  description: "Returns only identity fields needed to select a user who can receive a permission or role assignment.",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { query: userCatalogListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of active user identities.",
      content: {
        "application/json": { schema: userCatalogListResponseSchema },
      },
    },
  },
};

export const PERMISSION_TARGETS_SORT_COLUMNS = ["name"] as const;
export const permissionTargetsListQuerySchema = listQuerySchema(PERMISSION_TARGETS_SORT_COLUMNS, {
  limit: 25,
  maxLimit: 50,
}).extend({
  contextType: authorizationContextTypeSchema,
  q: searchTermSchema,
});
export type PermissionTargetsListQuery = z.infer<typeof permissionTargetsListQuerySchema>;

export const permissionTargetSchema = z.object({
  id: databaseIdSchema,
  type: authorizationContextTypeSchema,
  name: z.string(),
});
export type PermissionTarget = z.infer<typeof permissionTargetSchema>;
export const permissionTargetsListResponseSchema = paginatedResponseSchema("targets", permissionTargetSchema);

export const permissionTargetsListRouteSchema = {
  tags: ["Permissions"],
  summary: "Search permission targets",
  description:
    "Returns a bounded page of event, group, or organization-capacity targets. Organization target identifiers are members.id values.",
  "x-pkic-auth": { required: true, scopes: ["access:grant", "access:revoke"] },
  request: { query: permissionTargetsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of assignable resource targets.",
      content: {
        "application/json": { schema: permissionTargetsListResponseSchema },
      },
    },
  },
};
