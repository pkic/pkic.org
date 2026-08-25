/**
 * Phase 1 §1.4 required test: contextTypeSchema accepts 'organization'
 * (assets/shared/schemas/access-control.ts) — added so representative-role
 * grants (context_type='organization') validate through the same contract
 * as event/group-scoped grants. contextTypeSchema itself is a
 * private module const, exercised here through the two exported schemas
 * that embed it.
 */
import { describe, expect, it } from "vitest";
import { userRoleAssignSchema, accessGrantCreateSchema } from "../assets/shared/schemas/access-control";

describe("access-control contextTypeSchema", () => {
  it("userRoleAssignSchema accepts context_type='organization' for a representative-role grant", () => {
    const result = userRoleAssignSchema.safeParse({
      roleId: "role-primary_contact",
      contextType: "organization",
      contextId: crypto.randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it("accessGrantCreateSchema also accepts context_type='organization'", () => {
    const result = accessGrantCreateSchema.safeParse({
      userId: crypto.randomUUID(),
      permission: "membership:write",
      contextType: "organization",
      contextId: crypto.randomUUID(),
    });
    expect(result.success).toBe(true);
  });

  it("still rejects an unrecognized context type", () => {
    const result = userRoleAssignSchema.safeParse({
      roleId: "role-primary_contact",
      contextType: "not_a_real_context",
      contextId: crypto.randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it("accepts the canonical 'event' and 'group' context types", () => {
    for (const contextType of ["event", "group"]) {
      const result = userRoleAssignSchema.safeParse({
        roleId: "role-group_lead",
        contextType,
        contextId: crypto.randomUUID(),
      });
      expect(result.success, `expected ${contextType} to validate`).toBe(true);
    }
  });

  it.each([userRoleAssignSchema, accessGrantCreateSchema])(
    "requires contextType and contextId to be supplied together",
    (schema) => {
      const common =
        schema === userRoleAssignSchema
          ? { roleId: "role-group_lead" }
          : { userId: crypto.randomUUID(), permission: "membership:write" };

      expect(schema.safeParse({ ...common, contextType: "working_group" }).success).toBe(false);
      expect(schema.safeParse({ ...common, contextId: crypto.randomUUID() }).success).toBe(false);
    },
  );
});
