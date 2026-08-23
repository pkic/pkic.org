/**
 * Phase 3 §3.1: roleResponseSchema.id and userRoleResponseSchema.roleId
 * previously declared z.uuid(), rejecting the built-in system role ids
 * (role-admin, role-wg_chair, ...) that GET /roles and the user-roles
 * endpoints actually return. Both now reuse the same roleIdSchema as
 * roleIdParamsSchema — this asserts the response contracts accept a
 * built-in system role id, not just a custom-role uuid().
 */
import { describe, expect, it } from "vitest";
import {
  roleIdParamsSchema,
  roleIdSchema,
  roleResponseSchema,
  userRoleResponseEnvelopeSchema,
  userRoleResponseSchema,
} from "../assets/shared/schemas/access-control";

const SYSTEM_ROLE_ID = "role-admin";

describe("access-control role id response contracts", () => {
  it("roleIdSchema accepts a built-in system role id", () => {
    expect(roleIdSchema.safeParse(SYSTEM_ROLE_ID).success).toBe(true);
  });

  it("roleIdSchema still accepts a custom-role uuid", () => {
    expect(roleIdSchema.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it("roleResponseSchema.id accepts a built-in system role id", () => {
    const result = roleResponseSchema.safeParse({
      id: SYSTEM_ROLE_ID,
      name: "admin",
      description: null,
      isSystemRole: true,
      permissions: ["admin:read"],
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("userRoleResponseSchema.roleId accepts a built-in system role id", () => {
    const result = userRoleResponseSchema.safeParse({
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      roleId: SYSTEM_ROLE_ID,
      roleName: "Admin",
      contextType: null,
      contextId: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("matches the role assignment command envelope returned by admin routes", () => {
    const role = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      roleId: SYSTEM_ROLE_ID,
      roleName: "Admin",
      contextType: null,
      contextId: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(userRoleResponseEnvelopeSchema.parse({ role })).toEqual({ role });
    expect(userRoleResponseEnvelopeSchema.safeParse(role).success).toBe(false);
  });

  it("roleIdParamsSchema and roleResponseSchema/userRoleResponseSchema.roleId share one schema instance", () => {
    expect(roleIdParamsSchema.shape.id).toBe(roleIdSchema);
    expect(roleResponseSchema.shape.id).toBe(roleIdSchema);
    expect(userRoleResponseSchema.shape.roleId).toBe(roleIdSchema);
  });
});
