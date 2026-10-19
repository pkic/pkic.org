/**
 * Phase 1 §1.4 required test: contextTypeSchema accepts 'organization'
 * (assets/shared/schemas/access-control.ts) — added so representative-role
 * grants (context_type='organization') validate through the same contract
 * as event/group-scoped grants. contextTypeSchema itself is a
 * private module const, exercised here through the two exported schemas
 * that embed it.
 */
import { describe, expect, it } from "vitest";
import { PERMISSION_METADATA, PERMISSION_DOMAINS } from "../assets/shared/permission-metadata";
import { PERMISSIONS, permissionSchema } from "../assets/shared/schemas/permissions";
import {
  userRoleAssignSchema,
  accessGrantCreateSchema,
  permissionTargetsListQuerySchema,
  permissionTargetSchema,
} from "../assets/shared/schemas/access-control";

describe("permission target catalog queries", () => {
  it.each(["event", "group", "organization"])("allows browsing %s targets before searching", (contextType) => {
    expect(permissionTargetsListQuerySchema.parse({ contextType, limit: "25", offset: "0", sort: "name" })).toEqual({
      contextType,
      limit: 25,
      offset: 0,
      sort: "name",
    });
  });

  it("retains bounded search validation", () => {
    expect(permissionTargetsListQuerySchema.parse({ contextType: "event", q: "  Conference  " }).q).toBe("Conference");
    for (const q of ["", " ", "x".repeat(255)]) {
      expect(permissionTargetsListQuerySchema.safeParse({ contextType: "event", q }).success).toBe(false);
    }
  });
});

describe("permission target identifiers", () => {
  it.each([crypto.randomUUID(), "event-meeting-board", `event-meeting-${"a".repeat(100)}`])(
    "accepts the event identifier %s in catalogs and assignment forms",
    (id) => {
      expect(permissionTargetSchema.parse({ id, type: "event", name: "Example meeting" }).id).toBe(id);
      expect(userRoleAssignSchema.parse({ roleId: "role-admin", contextType: "event", contextId: id }).contextId).toBe(
        id,
      );
      expect(
        accessGrantCreateSchema.parse({
          userId: crypto.randomUUID(),
          permission: "events:read",
          contextType: "event",
          contextId: id,
        }).contextId,
      ).toBe(id);
    },
  );

  it.each(["group", "organization"])("keeps generated identifiers for %s targets", (type) => {
    expect(permissionTargetSchema.safeParse({ id: "event-meeting-board", type, name: "Example" }).success).toBe(false);
    const id = crypto.randomUUID();
    expect(permissionTargetSchema.parse({ id, type, name: "Example" }).id).toBe(id);
  });
});

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

describe("canonical permission metadata", () => {
  it("defines every supported scope exactly once with an existing domain", () => {
    expect(PERMISSIONS).toEqual(permissionSchema.options);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS)
      expect(PERMISSION_DOMAINS).toHaveProperty(PERMISSION_METADATA[permission].domain);
    expect(permissionSchema.safeParse("events:*").success).toBe(false);
  });
  it.each([
    "donations:sync",
    "retention:run",
    "access:grant",
    "proposals:score",
    "agenda:scan",
    "agenda:live_moderate",
  ] as const)("classifies %s as a write without guessing its suffix", (permission) => {
    expect(PERMISSION_METADATA[permission].access).toBe("write");
  });
  it.each(["agenda:attendance_read", "agenda:leads_view", "agenda:leads_export", "agenda:check"] as const)(
    "classifies %s as a read without granting scanner writes",
    (permission) => {
      expect(PERMISSION_METADATA[permission].access).toBe("read");
    },
  );
});

describe("OAuth selected scopes and contextual ceilings", () => {
  it.each([undefined, [], ["forms:*"], ["unknown:read"], ["forms:read", "forms:read"], "forms:read"])(
    "rejects invalid selected scopes (%j)",
    async (selectedScopes) => {
      const { mcpOauthAuthorizeActionSchema } = await import("../assets/shared/schemas/mcp-oauth");
      expect(
        mcpOauthAuthorizeActionSchema.safeParse({
          action: "approve",
          return_to: "/api/v1/auth/oauth/authorize",
          scopes: selectedScopes,
          actingIdentityId: null,
        }).success,
      ).toBe(false);
    },
  );
  it("accepts a canonical subset without requiring every requested scope", async () => {
    const { mcpOauthAuthorizeActionSchema } = await import("../assets/shared/schemas/mcp-oauth");
    expect(
      mcpOauthAuthorizeActionSchema.safeParse({
        action: "approve",
        return_to: "/api/v1/auth/oauth/authorize",
        scopes: ["forms:read"],
        actingIdentityId: null,
      }).success,
    ).toBe(true);
  });
  it("requires the displayed identity even when approving without a membership", async () => {
    const { mcpOauthAuthorizeActionSchema } = await import("../assets/shared/schemas/mcp-oauth");
    expect(
      mcpOauthAuthorizeActionSchema.safeParse({
        action: "approve",
        return_to: "/api/v1/auth/oauth/authorize",
        scopes: ["forms:read"],
      }).success,
    ).toBe(false);
  });
  it("requires paired contexts and rejects duplicate permission limits", async () => {
    const { oauthAuthorizationScopesSchema } = await import("../assets/shared/schemas/oauth-authorizations");
    const scope = { permission: "forms:read", contextType: "event", contextId: crypto.randomUUID() };
    expect(oauthAuthorizationScopesSchema.safeParse([scope]).success).toBe(true);
    expect(oauthAuthorizationScopesSchema.safeParse([scope, scope]).success).toBe(false);
    expect(oauthAuthorizationScopesSchema.safeParse([{ ...scope, contextId: null }]).success).toBe(false);
  });
});
