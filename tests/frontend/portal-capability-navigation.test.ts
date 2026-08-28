import { describe, expect, it } from "vitest";
import { portalMagicLinkToken } from "../../assets/ts/member-flows/portal/App";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
  portalHasGlobalPermission,
  portalHasSystemManagement,
  portalNavigationItems,
  portalSystemNavigationItems,
  portalActiveSection,
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
    expect(labels).toContain("System");
    expect(labels).toContain("Account Settings");
    expect(labels).not.toContain("My Profile");
  });

  it("shows system management only for the matching global permission", () => {
    const globalAudit = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "audit:read", contextType: null, contextId: null }],
    });
    const contextualAudit = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "audit:read", contextType: "group", contextId: "group-1" }],
    });
    expect(portalHasGlobalPermission(globalAudit, "audit:read")).toBe(true);
    expect(portalNavigationItems(globalAudit).map((item) => item.label)).toContain("System");
    expect(portalHasGlobalPermission(contextualAudit, "audit:read")).toBe(false);
    expect(portalNavigationItems(contextualAudit).map((item) => item.label)).not.toContain("System");
    expect(portalCapacityFallbackPath(contextualAudit, "/system/audit-log")).toBe("/management");
  });

  it("shows only the system-management tabs granted to a staff identity", () => {
    const contentReviewer = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "organizations:content-review", contextType: null, contextId: null }],
    });
    expect(portalHasSystemManagement(contentReviewer)).toBe(true);
    expect(portalNavigationItems(contentReviewer)).toContainEqual({
      path: "/system/organization-content-reviews",
      section: "system",
      label: "System",
    });
    expect(portalSystemNavigationItems(contentReviewer)).toEqual([
      {
        path: "/system/organization-content-reviews",
        section: "system",
        label: "Content Reviews",
      },
    ]);
    expect(portalCapacityFallbackPath(contentReviewer, "/system/organization-content-reviews")).toBeNull();
  });

  it("exposes membership applications only to a global membership reader", () => {
    const reader = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "membership:read", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "membership:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(reader)).toEqual([
      {
        path: "/system/membership-applications",
        section: "system",
        label: "Membership Applications",
      },
      {
        path: "/system/membership-settings",
        section: "system",
        label: "Membership Settings",
      },
    ]);
    expect(portalSystemNavigationItems(contextualReader)).toEqual([]);
  });

  it("exposes email templates only to a global reader and preserves write capability separately", () => {
    const reader = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "email-templates:read", contextType: null, contextId: null }],
    });
    const writer = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [
        { permission: "email-templates:read", contextType: null, contextId: null },
        { permission: "email-templates:write", contextType: null, contextId: null },
      ],
    });
    const contextualReader = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "email-templates:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(reader)).toContainEqual({
      path: "/system/email-templates",
      section: "system",
      label: "Email Templates",
    });
    expect(portalHasGlobalPermission(reader, "email-templates:write")).toBe(false);
    expect(portalHasGlobalPermission(writer, "email-templates:write")).toBe(true);
    expect(portalSystemNavigationItems(contextualReader)).toEqual([]);
  });

  it("exposes Access Control for either global grant or revoke authority, never contextual authority", () => {
    const grantOnly = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "access:grant", contextType: null, contextId: null }],
    });
    const revokeOnly = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "access:revoke", contextType: null, contextId: null }],
    });
    const contextual = portalSessionFixture({
      admin: true,
      adminRole: "user",
      grants: [{ permission: "access:grant", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(grantOnly)).toContainEqual({
      path: "/system/access-control",
      section: "system",
      label: "Access Control",
    });
    expect(portalSystemNavigationItems(revokeOnly)).toContainEqual({
      path: "/system/access-control",
      section: "system",
      label: "Access Control",
    });
    expect(portalSystemNavigationItems(contextual)).not.toContainEqual(
      expect.objectContaining({ path: "/system/access-control" }),
    );
    expect(portalCapacityFallbackPath(contextual, "/system/access-control")).toBe("/management");
  });

  it("shows member actions but no management entry to a member-only identity", () => {
    const labels = portalNavigationItems(portalSessionFixture({ member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).toContain("Account Settings");
    expect(labels).toContain("Groups");
    expect(labels).not.toContain("Working Groups");
    expect(labels).not.toContain("Management");
  });

  it("redirects superseded member group and uploaded-calendar routes to groups", () => {
    expect(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).toEqual({
      "/working-groups": "/groups",
      "/calendar": "/groups",
    });
  });

  it("shows both navigation capacities to one dual-capacity identity", () => {
    const labels = portalNavigationItems(portalSessionFixture({ admin: true, member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).toContain("Management");
    expect(labels).toContain("Account Settings");
  });

  it("keeps shared selected-group routes after member-capacity loss", () => {
    const staffOnly = portalSessionFixture({ admin: true });
    expect(portalDefaultPath(staffOnly)).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/profile")).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/working-groups")).toBe("/management");
    expect(portalCapacityFallbackPath(staffOnly, "/groups/group-id/meetings")).toBeNull();
    expect(portalCapacityFallbackPath(staffOnly, "/management")).toBeNull();
    expect(portalCapacityFallbackPath(staffOnly, "/management/group-id/overview")).toBeNull();
  });

  it("moves a selected-group management route after live staff-capacity loss", () => {
    const memberOnly = portalSessionFixture({ member: true });
    expect(portalCapacityFallbackPath(memberOnly, "/management/group-id/overview")).toBe("/profile");
  });

  it("keeps a selected-group meeting route for a current member", () => {
    const memberOnly = portalSessionFixture({ member: true });
    expect(portalCapacityFallbackPath(memberOnly, "/groups/group-id/meetings")).toBeNull();
  });

  it("keeps selected-group routes for staff and highlights their management entry", () => {
    const staffOnly = portalSessionFixture({ admin: true });
    expect(portalCapacityFallbackPath(staffOnly, "/groups/group-id/overview")).toBeNull();
    expect(portalActiveSection("/groups/group-id/overview", staffOnly)).toBe("management");
  });

  it("preserves a genuine unknown route instead of hiding it behind a redirect", () => {
    expect(portalCapacityFallbackPath(portalSessionFixture({ admin: true }), "/not-a-portal-route")).toBeNull();
  });
});
