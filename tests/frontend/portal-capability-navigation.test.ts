import { describe, expect, it } from "vitest";
import { portalMagicLinkToken } from "../../assets/ts/member-flows/portal/hash-route";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
  portalHasGlobalPermission,
  portalHasPermissionAtAnyScope,
  portalHasSystemManagement,
  portalNavigationItems,
  portalSectionEnabled,
  portalSystemNavigationItems,
  portalActiveSection,
} from "../../assets/ts/member-flows/portal/shell/portal-navigation";
import { portalSessionFixture } from "../helpers/portal-session";

describe("portal capability-derived navigation", () => {
  it("reads magic-link credentials only from the URL fragment", () => {
    expect(portalMagicLinkToken("#/verify?token=secret-token")).toBe("secret-token");
    expect(portalMagicLinkToken("#/verify")).toBeNull();
  });

  it("shows the group workspace but no member actions to a staff-only identity", () => {
    const session = portalSessionFixture({ staff: true });
    const labels = portalNavigationItems(session).map((item) => item.label);
    expect(labels).toContain("Groups");
    expect(labels).toContain("Settings");
    expect(labels).not.toContain("Management");
    expect(labels).not.toContain("My Profile");
    // Account settings moved into the user menu; it is a section, not a sidebar item.
    expect(labels).not.toContain("Account Settings");
    expect(portalSectionEnabled(session, "account")).toBe(true);
  });

  it("shows system management only for the matching global permission", () => {
    const globalAudit = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "audit:read", contextType: null, contextId: null }],
    });
    const contextualAudit = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "audit:read", contextType: "group", contextId: "group-1" }],
    });
    expect(portalHasGlobalPermission(globalAudit, "audit:read")).toBe(true);
    expect(portalNavigationItems(globalAudit).map((item) => item.label)).toContain("Settings");
    expect(portalHasGlobalPermission(contextualAudit, "audit:read")).toBe(false);
    expect(portalNavigationItems(contextualAudit).map((item) => item.label)).not.toContain("Settings");
    expect(portalCapacityFallbackPath(contextualAudit, "/system/audit-log")).toBe("/home");
  });

  it("shows only the system-management tabs granted to a staff identity", () => {
    const contentReviewer = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "organizations:content-review", contextType: null, contextId: null }],
    });
    expect(portalHasSystemManagement(contentReviewer)).toBe(true);
    expect(portalNavigationItems(contentReviewer)).toContainEqual({
      path: "/system/organization-content-reviews",
      section: "system",
      label: "Settings",
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

  it("exposes System Analytics only to a global analytics reader", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "analytics:read", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "analytics:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(reader)).toEqual([
      { path: "/system/analytics", section: "system", label: "Analytics" },
    ]);
    expect(portalSystemNavigationItems(contextualReader)).toEqual([]);
    expect(portalCapacityFallbackPath(contextualReader, "/system/analytics")).toBe("/home");
  });

  it("exposes Forms only to global form readers", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "forms:read", contextType: null, contextId: null }],
    });
    const writerOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "forms:write", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "forms:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalNavigationItems(reader)).toContainEqual({ path: "/forms", section: "forms", label: "Forms" });
    expect(portalCapacityFallbackPath(reader, "/forms/member-feedback")).toBeNull();
    expect(portalNavigationItems(writerOnly)).not.toContainEqual(expect.objectContaining({ path: "/forms" }));
    expect(portalCapacityFallbackPath(writerOnly, "/forms")).toBe("/home");
    expect(portalNavigationItems(contextualReader)).not.toContainEqual(expect.objectContaining({ path: "/forms" }));
  });

  it("exposes Events to global and event-scoped readers, but not unrelated staff", () => {
    const globalReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "events:read", contextType: null, contextId: null }],
    });
    const eventReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "events:read", contextType: "event", contextId: "event-1" }],
    });
    const proposalOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "proposals:read", contextType: "event", contextId: "event-1" }],
    });

    expect(portalHasPermissionAtAnyScope(globalReader, "events:read")).toBe(true);
    expect(portalHasPermissionAtAnyScope(eventReader, "events:read")).toBe(true);
    expect(portalNavigationItems(globalReader)).toContainEqual({ path: "/events", section: "events", label: "Events" });
    expect(portalNavigationItems(eventReader)).toContainEqual({ path: "/events", section: "events", label: "Events" });
    expect(portalCapacityFallbackPath(eventReader, "/events/event-1/settings")).toBeNull();
    // Proposal reviewers reach their programs through the Events domain.
    expect(portalNavigationItems(proposalOnly)).toContainEqual({ path: "/events", section: "events", label: "Events" });
    expect(portalCapacityFallbackPath(proposalOnly, "/events/event-1")).toBeNull();
  });

  it("exposes Donations to global readers or synchronizers", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "donations:read", contextType: null, contextId: null }],
    });
    const synchronizer = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "donations:sync", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "donations:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalNavigationItems(reader)).toContainEqual({
      path: "/donations",
      section: "donations",
      label: "Donations",
    });
    expect(portalNavigationItems(synchronizer)).toContainEqual({
      path: "/donations",
      section: "donations",
      label: "Donations",
    });
    expect(portalHasGlobalPermission(reader, "donations:read")).toBe(true);
    expect(portalHasGlobalPermission(synchronizer, "donations:read")).toBe(false);
    expect(portalNavigationItems(contextualReader)).not.toContainEqual(expect.objectContaining({ path: "/donations" }));
    // Donations is a domain entry now, not part of the Settings residue.
    expect(portalSystemNavigationItems(reader)).toEqual([]);
  });

  it("exposes Sponsors as a resource workspace to global readers or writers", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "sponsorships:read", contextType: null, contextId: null }],
    });
    const writer = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "sponsorships:read", contextType: null, contextId: null },
        { permission: "sponsorships:write", contextType: null, contextId: null },
      ],
    });
    const writeOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "sponsorships:write", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "sponsorships:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalNavigationItems(reader)).toContainEqual({
      path: "/sponsors",
      section: "sponsors",
      label: "Sponsors",
    });
    expect(portalHasGlobalPermission(reader, "sponsorships:write")).toBe(false);
    expect(portalHasGlobalPermission(writer, "sponsorships:write")).toBe(true);
    expect(portalNavigationItems(writeOnly)).toContainEqual({
      path: "/sponsors",
      section: "sponsors",
      label: "Sponsors",
    });
    expect(portalNavigationItems(contextualReader)).not.toContainEqual(expect.objectContaining({ path: "/sponsors" }));
  });

  it("exposes Organizations to global readers or membership writers", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "organizations:read", contextType: null, contextId: null }],
    });
    const membershipWriter = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "membership:write", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "organizations:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalNavigationItems(reader)).toContainEqual({
      path: "/organizations",
      section: "organizations",
      label: "Organizations",
    });
    expect(portalNavigationItems(membershipWriter)).toContainEqual({
      path: "/organizations",
      section: "organizations",
      label: "Organizations",
    });
    expect(portalNavigationItems(contextualReader)).not.toContainEqual(
      expect.objectContaining({ path: "/organizations" }),
    );
  });

  it("exposes Users only to a global reader, while retaining action permissions after entry", () => {
    const actionOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "users:write", contextType: null, contextId: null },
        { permission: "users:anonymize", contextType: null, contextId: null },
        { permission: "membership:write", contextType: null, contextId: null },
      ],
    });
    const readerAndWriter = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "users:read", contextType: null, contextId: null },
        { permission: "users:write", contextType: null, contextId: null },
      ],
    });

    expect(portalNavigationItems(actionOnly)).not.toContainEqual(expect.objectContaining({ path: "/users" }));
    expect(portalNavigationItems(readerAndWriter)).toContainEqual({
      path: "/users",
      section: "users",
      label: "Users",
    });
    expect(portalHasGlobalPermission(readerAndWriter, "users:write")).toBe(true);
  });

  it("exposes membership applications only to a global membership reader", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "membership:read", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "membership:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalNavigationItems(reader)).toContainEqual({
      path: "/membership/applications",
      section: "membership",
      label: "Membership",
    });
    expect(portalSystemNavigationItems(reader)).toEqual([
      {
        path: "/system/membership-settings",
        section: "system",
        label: "Membership Settings",
      },
    ]);
    expect(portalNavigationItems(contextualReader)).not.toContainEqual(
      expect.objectContaining({ path: "/membership/applications" }),
    );
    expect(portalSystemNavigationItems(contextualReader)).toEqual([]);
  });

  it("exposes email templates to a global reader or writer", () => {
    const reader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "email-templates:read", contextType: null, contextId: null }],
    });
    const writer = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "email-templates:read", contextType: null, contextId: null },
        { permission: "email-templates:write", contextType: null, contextId: null },
      ],
    });
    const writeOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "email-templates:write", contextType: null, contextId: null }],
    });
    const contextualReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "email-templates:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(reader)).toContainEqual({
      path: "/system/email-templates",
      section: "system",
      label: "Email Templates",
    });
    expect(portalHasGlobalPermission(reader, "email-templates:write")).toBe(false);
    expect(portalHasGlobalPermission(writer, "email-templates:write")).toBe(true);
    expect(portalSystemNavigationItems(writeOnly)).toContainEqual({
      path: "/system/email-templates",
      section: "system",
      label: "Email Templates",
    });
    expect(portalSystemNavigationItems(contextualReader)).toEqual([]);
  });

  it("exposes System Operations for global email, retention, or scheduler read authority", () => {
    const emailReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "email:read", contextType: null, contextId: null }],
    });
    const retentionReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "retention:read", contextType: null, contextId: null }],
    });
    const schedulerReader = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "scheduler:read", contextType: null, contextId: null }],
    });
    const writeOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "email:manage", contextType: null, contextId: null }],
    });
    const contextual = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "retention:read", contextType: "group", contextId: "group-1" }],
    });

    expect(portalSystemNavigationItems(emailReader)).toContainEqual({
      path: "/system/operations",
      section: "system",
      label: "Operations",
    });
    expect(portalSystemNavigationItems(retentionReader)).toContainEqual({
      path: "/system/operations",
      section: "system",
      label: "Operations",
    });
    expect(portalSystemNavigationItems(schedulerReader)).toContainEqual({
      path: "/system/operations",
      section: "system",
      label: "Operations",
    });
    expect(portalSystemNavigationItems(writeOnly)).not.toContainEqual(
      expect.objectContaining({ path: "/system/operations" }),
    );
    expect(portalSystemNavigationItems(contextual)).not.toContainEqual(
      expect.objectContaining({ path: "/system/operations" }),
    );
  });

  it("exposes Access Control for either global grant or revoke authority, never contextual authority", () => {
    const grantOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "access:grant", contextType: null, contextId: null }],
    });
    const revokeOnly = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "access:revoke", contextType: null, contextId: null }],
    });
    const contextual = portalSessionFixture({
      staff: true,
      staffRole: "user",
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
    expect(portalCapacityFallbackPath(contextual, "/system/access-control")).toBe("/home");
    expect(portalSystemNavigationItems(grantOnly)).toContainEqual({
      path: "/system/leadership",
      section: "system",
      label: "Leadership",
    });
    expect(portalSystemNavigationItems(revokeOnly)).toContainEqual({
      path: "/system/leadership",
      section: "system",
      label: "Leadership",
    });
    expect(portalSystemNavigationItems(contextual)).not.toContainEqual(
      expect.objectContaining({ path: "/system/leadership" }),
    );
  });

  it("shows member actions but no management entry to a member-only identity", () => {
    const session = portalSessionFixture({ member: true });
    const labels = portalNavigationItems(session).map((item) => item.label);
    expect(labels[0]).toBe("Home");
    // Identity destinations live in the avatar menu, not the sidebar.
    expect(labels).not.toContain("My Profile");
    expect(labels).not.toContain("My Application");
    expect(portalSectionEnabled(session, "profile")).toBe(true);
    expect(portalSectionEnabled(session, "participation")).toBe(true);
    expect(labels).toContain("Groups");
    // Organizations are reached through the avatar menu and dashboard; the
    // sidebar entry is the permission-gated directory.
    expect(labels).not.toContain("My Organization");
    expect(labels).not.toContain("Organizations");
    expect(portalSectionEnabled(session, "organizations")).toBe(true);
    expect(labels).not.toContain("Votes");
    expect(labels).not.toContain("Working Groups");
    expect(labels).not.toContain("Management");
    expect(labels).not.toContain("Account Settings");
    expect(portalSectionEnabled(session, "account")).toBe(true);
  });

  it("redirects superseded member group and uploaded-calendar routes to groups", () => {
    expect(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).toEqual({
      "/working-groups": "/groups",
      "/calendar": "/groups",
    });
  });

  it("shows both navigation capacities to one dual-capacity identity", () => {
    const session = portalSessionFixture({ staff: true, member: true });
    const labels = portalNavigationItems(session).map((item) => item.label);
    expect(labels).toContain("Groups");
    expect(labels).not.toContain("Management");
    expect(portalSectionEnabled(session, "profile")).toBe(true);
  });

  it("keeps shared selected-group routes after member-capacity loss", () => {
    const staffOnly = portalSessionFixture({ staff: true });
    expect(portalDefaultPath(staffOnly)).toBe("/home");
    expect(portalCapacityFallbackPath(staffOnly, "/profile")).toBe("/home");
    expect(portalCapacityFallbackPath(staffOnly, "/groups/group-id/meetings")).toBeNull();
    // Superseded /management and /working-groups URLs redirect within the groups section.
    expect(portalCapacityFallbackPath(staffOnly, "/working-groups")).toBeNull();
    expect(portalCapacityFallbackPath(staffOnly, "/management")).toBeNull();
    expect(portalCapacityFallbackPath(staffOnly, "/management/group-id/overview")).toBeNull();
  });

  it("keeps a superseded management route for a member because groups own it now", () => {
    const memberOnly = portalSessionFixture({ member: true });
    expect(portalCapacityFallbackPath(memberOnly, "/management/group-id/overview")).toBeNull();
    expect(portalDefaultPath(memberOnly)).toBe("/home");
  });

  it("keeps a selected-group meeting route for a current member", () => {
    const memberOnly = portalSessionFixture({ member: true });
    expect(portalCapacityFallbackPath(memberOnly, "/groups/group-id/meetings")).toBeNull();
  });

  it("keeps selected-group routes for staff and highlights the groups entry", () => {
    const staffOnly = portalSessionFixture({ staff: true });
    expect(portalCapacityFallbackPath(staffOnly, "/groups/group-id/overview")).toBeNull();
    expect(portalActiveSection("/groups/group-id/overview")).toBe("groups");
    expect(portalActiveSection("/management/group-id/overview")).toBe("groups");
    expect(portalActiveSection("/system/audit-log")).toBe("system");
  });

  it("preserves a genuine unknown route instead of hiding it behind a redirect", () => {
    expect(portalCapacityFallbackPath(portalSessionFixture({ staff: true }), "/not-a-portal-route")).toBeNull();
  });
});
