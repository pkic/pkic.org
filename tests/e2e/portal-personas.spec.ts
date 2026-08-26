import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser-level contract for the selected-group shell. The API responses are
 * purpose-built synthetic fixtures: this suite checks that each identity sees
 * only the navigation implied by its live group capabilities, without sharing
 * or clearing the E2E email interceptor. Backend inheritance, local-only
 * resolution, and capability authorization remain covered by the mounted
 * Hono/Vitest suites; these browser personas intentionally do not duplicate
 * that database setup.
 */

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const MEMBER_ID = "30000000-0000-4000-8000-000000000001";

const group = {
  id: GROUP_ID,
  slug: "synthetic-architecture-group",
  name: "Synthetic Architecture Group",
  type: {
    key: "working_group",
    singularLabel: "Working group",
    pluralLabel: "Working groups",
  },
  parentGroup: null,
  description: "Synthetic browser-test group.",
  links: [],
  visibility: "authenticated" as const,
  governanceInheritanceMode: "inherited" as const,
  eligibilityMode: "managed" as const,
  automaticEnrollmentMode: "none" as const,
  allowAutomaticOptOut: false,
  publicLeadership: false,
  minEndorsersForBallot: 1,
  active: true,
  revision: 0,
  membershipCapacityCount: 1,
  participantCount: 1,
  childCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

type Persona = {
  label: string;
  email: string;
  capabilities: Array<"view" | "participate" | "manage">;
  member: boolean;
  admin: boolean;
};

const PERSONAS: Record<string, Persona> = {
  participant: {
    label: "member participant",
    email: "synthetic-participant@example.test",
    capabilities: ["view", "participate"],
    member: true,
    admin: false,
  },
  directManager: {
    label: "direct group manager",
    email: "synthetic-chair@example.test",
    capabilities: ["view", "manage"],
    member: true,
    admin: true,
  },
  inheritedManager: {
    label: "inherited manager",
    email: "synthetic-parent-chair@example.test",
    capabilities: ["view", "manage"],
    member: false,
    admin: true,
  },
  localOnly: {
    label: "local-only child participant",
    email: "synthetic-local-only@example.test",
    capabilities: ["view", "participate"],
    member: true,
    admin: false,
  },
  staffOnly: {
    label: "staff-only manager",
    email: "synthetic-staff@example.test",
    capabilities: ["view", "manage"],
    member: false,
    admin: true,
  },
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function sessionFor(persona: Persona): Record<string, unknown> {
  return {
    success: true,
    identity: { id: USER_ID, email: persona.email },
    ...(persona.admin
      ? {
          admin: {
            id: USER_ID,
            email: persona.email,
            role: "staff",
            scopes: ["portal"],
            grants: [],
            expiresAt: null,
          },
        }
      : {}),
    ...(persona.member
      ? {
          member: {
            userId: USER_ID,
            email: persona.email,
            memberId: MEMBER_ID,
            organizationId: null,
            membershipCategory: "H5",
            isEcMember: false,
          },
        }
      : {}),
  };
}

function profileFor(persona: Persona): Record<string, unknown> {
  return {
    userId: USER_ID,
    email: persona.email,
    firstName: "Synthetic",
    lastName: "Persona",
    preferredName: null,
    jobTitle: "Browser test",
    biography: null,
    links: [],
    membershipCategory: "H5",
    organizationId: null,
    organizationName: null,
    memberSince: "2026-08-01",
    showOnOrgProfile: false,
    headshotUrl: null,
    canEditOrganizationName: false,
    isOrgContact: false,
    organizationRepresentatives: null,
    activeMemberships: [
      {
        memberId: MEMBER_ID,
        organizationId: null,
        organizationName: null,
        membershipCategory: "H5",
      },
    ],
  };
}

async function installPersona(page: Page, persona: Persona): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/portal/session") {
      await json(route, sessionFor(persona));
      return;
    }
    if (url.pathname === "/api/v1/me") {
      await json(route, profileFor(persona));
      return;
    }
    if (url.pathname === `/api/v1/groups/${GROUP_ID}/context`) {
      await json(route, { group, capabilities: persona.capabilities });
      return;
    }
    if (url.pathname === "/api/v1/groups") {
      await json(route, { groups: [group], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      return;
    }
    await json(route, {});
  });
}

async function openGroup(page: Page, persona: Persona): Promise<void> {
  await installPersona(page, persona);
  await page.goto(`/portal/#/groups/${GROUP_ID}/overview`);
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: `${group.name} sections` })).toBeVisible();
}

function sectionLinks(page: Page): ReturnType<Page["getByRole"]> {
  return page.getByRole("navigation", { name: `${group.name} sections` }).getByRole("link");
}

test.describe("selected-group portal personas", () => {
  test("member participant sees collaboration sections but no management sections", async ({ page }) => {
    await openGroup(page, PERSONAS.participant);
    await expect(sectionLinks(page)).toHaveText(["Overview", "Events", "Meetings", "Forms", "Votes", "Mailing lists"]);
    await expect(page.getByRole("link", { name: "Management" })).toHaveCount(0);
  });

  test("direct chair sees the complete group management surface", async ({ page }) => {
    await openGroup(page, PERSONAS.directManager);
    await expect(sectionLinks(page)).toHaveText([
      "Overview",
      "Events",
      "Meetings",
      "Forms",
      "Votes",
      "Statistics",
      "Mailing lists",
      "Audit log",
      "Settings",
      "Members",
      "Leadership",
    ]);
    await expect(page.getByRole("link", { name: "Management" })).toBeVisible();
  });

  test("inherited manager gets the same resource surface through the selected group", async ({ page }) => {
    await openGroup(page, PERSONAS.inheritedManager);
    await expect(sectionLinks(page)).toContainText(["Settings", "Members", "Leadership"]);
    await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  });

  test("local-only child participant cannot see management controls", async ({ page }) => {
    await openGroup(page, PERSONAS.localOnly);
    await expect(sectionLinks(page)).not.toContainText(["Settings", "Members", "Leadership", "Statistics"]);
    await expect(page.getByRole("link", { name: "Management" })).toHaveCount(0);
  });

  test("staff-only manager enters the same portal without member navigation", async ({ page }) => {
    await openGroup(page, PERSONAS.staffOnly);
    await expect(sectionLinks(page)).toContainText(["Settings", "Members", "Leadership"]);
    await expect(page.getByRole("link", { name: "My Profile" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Management" })).toBeVisible();
  });

  test("unauthorized identity stays on login and cannot render a selected group", async ({ page }) => {
    await page.route("**/api/v1/auth/portal/session", async (route) => {
      await json(route, { error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    });
    await page.goto(`/portal/#/groups/${GROUP_ID}/overview`);
    await expect(page.locator("#portal-inp-email")).toBeVisible();
    await expect(page.getByText(group.name)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
