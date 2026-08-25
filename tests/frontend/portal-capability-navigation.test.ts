import { describe, expect, it } from "vitest";
import { portalMagicLinkToken } from "../../assets/ts/member-flows/portal/App";
import { portalNavigationItems } from "../../assets/ts/member-flows/portal/shell/PortalShell";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

function portalSession(capacities: { admin?: boolean; member?: boolean }): PortalSession {
  const identity = { id: "00000000-0000-4000-8000-000000000001", email: "person@example.test" };
  return {
    success: true,
    identity,
    ...(capacities.admin
      ? {
          admin: {
            ...identity,
            role: "admin",
            scopes: [],
            grants: [],
            expiresAt: "2026-08-26T00:00:00.000Z",
          },
        }
      : {}),
    ...(capacities.member
      ? {
          member: {
            userId: identity.id,
            email: identity.email,
            memberId: "00000000-0000-4000-8000-000000000002",
            organizationId: null,
            membershipCategory: "H5",
            isEcMember: false,
          },
        }
      : {}),
  };
}

describe("portal capability-derived navigation", () => {
  it("reads magic-link credentials only from the URL fragment", () => {
    expect(portalMagicLinkToken("#/verify?token=secret-token")).toBe("secret-token");
    expect(portalMagicLinkToken("#/verify")).toBeNull();
  });

  it("shows management but no member actions to a staff-only identity", () => {
    const labels = portalNavigationItems(portalSession({ admin: true })).map((item) => item.label);
    expect(labels).toContain("Management");
    expect(labels).not.toContain("My Profile");
  });

  it("shows member actions but no management entry to a member-only identity", () => {
    const labels = portalNavigationItems(portalSession({ member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).not.toContain("Management");
  });

  it("shows both navigation capacities to one dual-capacity identity", () => {
    const labels = portalNavigationItems(portalSession({ admin: true, member: true })).map((item) => item.label);
    expect(labels).toContain("My Profile");
    expect(labels).toContain("Management");
  });
});
