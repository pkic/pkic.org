import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import {
  adminAuthorizationForRequest,
  enforceAdminRouteAuthorization,
  requireAdminRoutesHaveAuthorizationPolicy,
} from "../functions/_lib/auth/admin-route-policy";
import type { AuthAdmin } from "../functions/_lib/types";
import { proposalPermissionForRequest } from "../functions/_lib/auth/proposal-route-policy";

const actor = (permissions: string[]): AuthAdmin => ({
  id: "staff-1",
  email: "staff@example.test",
  role: "user",
  scopes: [],
  grants: permissions.map((permission) => ({
    permission,
    contextType: null,
    contextId: null,
  })),
});

describe("admin route authorization policy", () => {
  it("covers every registered admin route without a brittle inventory hash", () => {
    expect(() => requireAdminRoutesHaveAuthorizationPolicy(adminRouter.routes)).not.toThrow();
  });

  it("fails only an unknown module closed", () => {
    expect(() => adminAuthorizationForRequest("/api/v1/admin/unreviewed", "GET")).toThrowError(
      expect.objectContaining({ code: "ADMIN_ROUTE_POLICY_MISSING", status: 503 }),
    );
    expect(adminAuthorizationForRequest("/api/v1/admin/forms/example/submissions/stats", "GET")).toEqual({
      kind: "permission",
      permission: "admin:read",
    });
  });

  it("enforces named read and write permissions for centrally governed modules", () => {
    expect(() => enforceAdminRouteAuthorization(actor(["admin:read"]), "/api/v1/admin/forms", "GET")).not.toThrow();
    expect(() => enforceAdminRouteAuthorization(actor(["admin:read"]), "/api/v1/admin/forms", "POST")).toThrowError(
      expect.objectContaining({ code: "PERMISSION_REQUIRED", status: 403 }),
    );
    expect(() => enforceAdminRouteAuthorization(actor(["admin:write"]), "/api/v1/admin/forms", "POST")).not.toThrow();
  });

  it("leaves contextual modules to their resource-resolving router boundary", () => {
    expect(adminAuthorizationForRequest("/api/v1/admin/events/my-event/registrations", "GET")).toEqual({
      kind: "delegated",
      boundary: "event router",
    });
    expect(adminAuthorizationForRequest("/api/v1/admin/working-groups/wg-1/members", "POST")).toEqual({
      kind: "delegated",
      boundary: "working group router",
    });
  });

  it("uses one contextual proposal policy for read, score, and management actions", () => {
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/reviews", "GET")).toBe("proposals:read");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/reviews", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/comments", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/finalize", "POST")).toBe("proposals:manage");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/presentation/versions/v1", "DELETE")).toBe(
      "proposals:manage",
    );
  });
});
