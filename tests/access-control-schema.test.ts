/**
 * Phase 1 §1.4 required test: contextTypeSchema accepts 'organization'
 * (assets/shared/schemas/access-control.ts) — added so representative-role
 * grants (context_type='organization') validate through the same contract
 * as event/working_group-scoped grants. contextTypeSchema itself is a
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

  it("still accepts the pre-existing 'event' and 'working_group' context types", () => {
    for (const contextType of ["event", "working_group"]) {
      const result = userRoleAssignSchema.safeParse({
        roleId: "role-wg_chair",
        contextType,
        contextId: crypto.randomUUID(),
      });
      expect(result.success, `expected ${contextType} to validate`).toBe(true);
    }
  });
});
