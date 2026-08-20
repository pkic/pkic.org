import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import {
  adminRouteInventoryFingerprint,
  requireReviewedAdminRouteInventory,
} from "../functions/_lib/auth/admin-route-policy";

describe("admin route authorization policy", () => {
  it("keeps the registered non-auth routes on the reviewed inventory", () => {
    expect(adminRouteInventoryFingerprint(adminRouter.routes)).toEqual({
      routeCount: 189,
      fingerprint: "d38f5d14c74964bb",
    });
    expect(() => requireReviewedAdminRouteInventory(adminRouter.routes)).not.toThrow();
  });

  it("fails closed when a new route has not had an authorization review", () => {
    expect(() =>
      requireReviewedAdminRouteInventory([...adminRouter.routes, { method: "GET", path: "/unreviewed" }]),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_ROUTE_POLICY_OUT_OF_DATE", status: 503 }));
  });
});
