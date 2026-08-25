import { describe, expect, it } from "vitest";
import { portalMagicLinkToken } from "../../assets/ts/member-flows/portal/App";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
  portalNavigationItems,
} from "../../assets/ts/member-flows/portal/shell/portal-navigation";
import { portalSessionFixture } from "../helpers/portal-session";

describe("portal capability-derived navigation", () => {
  it("reads magic-link credentials only from the URL fragment", () => {
    expect(portalMagicLinkToken("#/verify?token=secret-token")).toBe("secret-token");
    expect(portalMagicLinkToken("#/verify")).toBeNull();
  });

  it("shows management but no member actions to a staff-only identity", () => {
    const labels = portalNavigationItems(portalSessionFixture({ admin: true })).map((item) => item.label);
    expect(labels).toContain("Management");
    expect(labels).not.toContain("My Profile");
  });

  it("shows member actions but no management entry to a member-only identity", () => {
    const labels = portalNavigationItems(portalSessionFixture({ member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).toContain("Groups");
    expect(labels).not.toContain("Working Groups");
    expect(labels).not.toContain("Management");
  });

  it("keeps one explicit compatibility redirect for the former member group route", () => {
    expect(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).toEqual({ "/working-groups": "/groups" });
  });

  it("shows both navigation capacities to one dual-capacity identity", () => {
    const labels = portalNavigationItems(portalSessionFixture({ admin: true, member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).toContain("Management");
  });

  it("moves a stale member route to management after live member-capacity loss", () => {
    const staffOnly = portalSessionFixture({ admin: true });
    expect(portalDefaultPath(staffOnly)).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/profile")).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/working-groups")).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/management")).toBeNull();
    expect(portalCapacityFallbackPath(staffOnly, "/management/group-id/overview")).toBeNull();
  });

  it("moves a selected-group management route after live staff-capacity loss", () => {
    const memberOnly = portalSessionFixture({ member: true });
    expect(portalCapacityFallbackPath(memberOnly, "/management/group-id/overview")).toBe("/profile");
  });

  it("preserves a genuine unknown route instead of hiding it behind a redirect", () => {
    expect(portalCapacityFallbackPath(portalSessionFixture({ admin: true }), "/not-a-portal-route")).toBeNull();
  });
});
