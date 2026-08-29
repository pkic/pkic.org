import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import {
  adminAuthorizationForRequest,
  requireAdminRoutesHaveAuthorizationPolicy,
} from "../functions/_lib/auth/admin-route-policy";
import {
  proposalPermissionAlternativesForRequest,
  proposalPermissionForRequest,
} from "../functions/_lib/auth/proposal-route-policy";

describe("admin route authorization policy", () => {
  it("covers every registered admin route without a brittle inventory hash", () => {
    expect(() => requireAdminRoutesHaveAuthorizationPolicy(adminRouter.routes)).not.toThrow();
  });

  it("fails only an unknown module closed", () => {
    expect(() => adminAuthorizationForRequest("/api/v1/admin/unreviewed", "GET")).toThrowError(
      expect.objectContaining({ code: "ADMIN_ROUTE_POLICY_MISSING", status: 503 }),
    );
  });

  it("lets a retired module reach its missing route and return 404", () => {
    expect(adminAuthorizationForRequest("/api/v1/admin/membership-settings", "GET")).toEqual({
      kind: "delegated",
      boundary: "retired admin API tombstone",
    });
    expect(adminAuthorizationForRequest("/api/v1/admin/email-templates", "GET")).toEqual({
      kind: "delegated",
      boundary: "retired admin API tombstone",
    });
    expect(adminAuthorizationForRequest("/api/v1/admin/vote-proposals", "GET")).toEqual({
      kind: "delegated",
      boundary: "retired admin API tombstone",
    });
    expect(adminAuthorizationForRequest("/api/v1/admin/votes", "GET")).toEqual({
      kind: "delegated",
      boundary: "retired admin API tombstone",
    });
  });

  it("leaves contextual modules to their resource-resolving router boundary", () => {
    expect(adminAuthorizationForRequest("/api/v1/admin/events/my-event/registrations", "GET")).toEqual({
      kind: "delegated",
      boundary: "event router",
    });
  });

  it("uses one contextual proposal policy for read, score, and management actions", () => {
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/reviews", "GET")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/reviews", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/audit-log", "GET")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/comments", "POST")).toBe("proposals:score");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/finalize", "POST")).toBe("proposals:manage");
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/presentation/versions/v1", "DELETE")).toBe(
      "proposals:manage",
    );
    expect(proposalPermissionAlternativesForRequest("/api/v1/admin/proposals/p1", "PATCH")).toEqual([
      "proposals:manage",
      "proposals:edit_accepted_abstract",
    ]);
    expect(proposalPermissionAlternativesForRequest("/api/v1/admin/proposals/p1/finalize", "POST")).toEqual([
      "proposals:manage",
    ]);
    expect(proposalPermissionForRequest("/api/v1/admin/proposals/p1/cancel", "POST")).toBe("proposals:cancel_accepted");
  });
});
