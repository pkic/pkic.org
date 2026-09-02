import { expect, test, type Page, type Route } from "@playwright/test";
import { groupMembershipsParticipantListResponseSchema } from "../../assets/shared/schemas/groups";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";

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
const IDENTITY_ID = "30000000-0000-4000-8000-000000000002";

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
  staff: boolean;
};

const PERSONAS: Record<string, Persona> = {
  participant: {
    label: "member participant",
    email: "synthetic-participant@example.test",
    capabilities: ["view", "participate"],
    member: true,
    staff: false,
  },
  directManager: {
    label: "direct group manager",
    email: "synthetic-chair@example.test",
    capabilities: ["view", "manage"],
    member: true,
    staff: true,
  },
  inheritedManager: {
    label: "inherited manager",
    email: "synthetic-parent-chair@example.test",
    capabilities: ["view", "manage"],
    member: false,
    staff: true,
  },
  localOnly: {
    label: "local-only child participant",
    email: "synthetic-local-only@example.test",
    capabilities: ["view", "participate"],
    member: true,
    staff: false,
  },
  staffOnly: {
    label: "staff-only manager",
    email: "synthetic-staff@example.test",
    capabilities: ["view", "manage"],
    member: false,
    staff: true,
  },
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const activeIdentities = [
  {
    identityId: IDENTITY_ID,
    memberId: MEMBER_ID,
    organizationId: null,
    organizationName: null,
    membershipCategory: "H5",
  },
];

// Built through the canonical session contract so a persona fixture can never
// drift from the schema the portal parses on boot.
function sessionFor(persona: Persona): Record<string, unknown> {
  return userAuthSessionResponseSchema.parse({
    success: true,
    identity: { id: USER_ID, email: persona.email },
    ...(persona.staff
      ? {
          staff: {
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
            identityId: IDENTITY_ID,
            email: persona.email,
            memberId: MEMBER_ID,
            organizationId: null,
            membershipCategory: "H5",
            isEcMember: false,
            activeIdentities,
          },
        }
      : {}),
  });
}

function profileFor(persona: Persona): Record<string, unknown> {
  return {
    userId: USER_ID,
    emailId: null,
    email: persona.email,
    emailAddresses: [
      {
        id: null,
        email: persona.email,
        primary: true,
        verifiedAt: null,
        verificationMethod: null,
      },
    ],
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
    organizationIdentities: null,
    activeIdentities,
  };
}

async function installPersona(page: Page, persona: Persona): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/session") {
      await json(route, sessionFor(persona));
      return;
    }
    if (url.pathname === "/api/v1/users/current") {
      await json(route, profileFor(persona));
      return;
    }
    if (url.pathname === `/api/v1/groups/${GROUP_ID}`) {
      await json(route, { group, capabilities: persona.capabilities });
      return;
    }
    if (url.pathname === "/api/v1/groups") {
      await json(route, { groups: [group], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      return;
    }
    if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`) {
      // The capability-shaped roster projection a participant receives: a
      // name, an organization, and nothing the manager payload carries.
      await json(
        route,
        groupMembershipsParticipantListResponseSchema.parse({
          memberships: [{ userId: USER_ID, name: "Synthetic Persona", headshotUrl: null, organizationName: null }],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      );
      return;
    }
    if (url.pathname === "/api/v1/users/current/groups") {
      // The group-centered sidebar's "Your groups" list draws joined groups
      // from this self-participation projection; only a member persona has
      // anything to report here.
      const groups = persona.member
        ? [
            {
              ...group,
              eligibleCapacities: [],
              memberships: [
                {
                  id: "40000000-0000-4000-8000-000000000001",
                  memberId: MEMBER_ID,
                  memberType: "individual",
                  organizationName: null,
                  source: "self_service",
                  joinedAt: "2026-08-01T00:00:00.000Z",
                  membershipCategory: "H5",
                },
              ],
            },
          ]
        : [];
      await json(route, { groups, page: { limit: 12, offset: 0, total: groups.length, hasMore: false } });
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

async function expectSections(page: Page, labels: readonly string[]): Promise<void> {
  const navigation = page.getByRole("navigation", { name: `${group.name} sections` });
  for (const label of labels) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
}

async function expectNoSections(page: Page, labels: readonly string[]): Promise<void> {
  const navigation = page.getByRole("navigation", { name: `${group.name} sections` });
  for (const label of labels) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
}

/**
 * A participant's Members tab is the read-only roster: a searchable list of
 * people, with none of the manager surface — no add form, no row menu, no
 * membership-capacity column.
 */
async function expectParticipantRoster(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: `${group.name} sections` });
  await navigation.getByRole("link", { name: "Members", exact: true }).click();
  const roster = page.getByRole("region", { name: "Members" });
  await expect(roster.getByRole("row").filter({ hasText: "Synthetic Persona" })).toBeVisible();
  await expect(roster.getByLabel("Search members")).toBeVisible();
  // No row commands at all: neither the menu a multi-action row would show nor
  // the inline button a single-action row would.
  await expect(roster.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
  await expect(roster.getByRole("button", { name: /^(Remove|End identity|Change role)/ })).toHaveCount(0);
  await expect(roster.getByRole("button", { name: /Add member/i })).toHaveCount(0);
  await expect(roster.getByRole("columnheader", { name: "Participation capacity" })).toHaveCount(0);
}

test.describe("selected-group portal personas", () => {
  test("member participant sees collaboration sections but no management sections", async ({ page }) => {
    await openGroup(page, PERSONAS.participant);
    // "Members" is a participant section: a participant sees who else is in
    // the group through the privacy-reduced roster projection.
    await expectSections(page, ["Overview", "Members", "Events", "Meetings", "Forms", "Votes", "Mailing lists"]);
    await expectNoSections(page, ["Settings", "Leadership", "Statistics", "Audit log"]);
    await expectParticipantRoster(page);
    // A plain member holds no global system permission, so the sidebar has no
    // admin surface at all.
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Organizations", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Membership", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Donations", exact: true })).toHaveCount(0);
  });

  test("direct chair sees the complete group management surface", async ({ page }) => {
    await openGroup(page, PERSONAS.directManager);
    await expectSections(page, [
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
    // The chair reaches group management through the group-centered sidebar:
    // the "Groups" entry, and this specific group listed under "Your groups".
    // The list shows names only; authority is expressed by the workspace tabs.
    // The breadcrumb also links "Groups" (the trail), so the assertion names
    // the sidebar landmark it means.
    const sidebar = page.getByRole("complementary", { name: "Portal navigation" });
    await expect(sidebar.getByRole("link", { name: "Groups", exact: true })).toBeVisible();
    const sidebarGroups = page.locator(".portal-sidebar-groups");
    await expect(sidebarGroups.getByRole("link", { name: group.name })).toBeVisible();
  });

  test("inherited manager gets the same resource surface through the selected group", async ({ page }) => {
    await openGroup(page, PERSONAS.inheritedManager);
    await expectSections(page, ["Settings", "Members", "Leadership"]);
    await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  });

  test("local-only child participant cannot see management controls", async ({ page }) => {
    await openGroup(page, PERSONAS.localOnly);
    await expectNoSections(page, ["Settings", "Leadership", "Statistics", "Audit log"]);
    // The roster this participant does reach carries no management affordance.
    await expectParticipantRoster(page);
    // No global system permission means no admin surface for this identity.
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Organizations", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Membership", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Donations", exact: true })).toHaveCount(0);
  });

  test("staff-only manager enters the same portal without member navigation", async ({ page }) => {
    await openGroup(page, PERSONAS.staffOnly);
    await expectSections(page, ["Settings", "Members", "Leadership"]);
    await expect(page.getByRole("link", { name: "My Profile" })).toHaveCount(0);
    // Reaches group management the same way any manager does: the "Groups"
    // sidebar entry and this group listed under "Your groups". The breadcrumb
    // also links "Groups" (the trail), so the assertion names the sidebar
    // landmark it means.
    const sidebar = page.getByRole("complementary", { name: "Portal navigation" });
    await expect(sidebar.getByRole("link", { name: "Groups", exact: true })).toBeVisible();
    const sidebarGroups = page.locator(".portal-sidebar-groups");
    await expect(sidebarGroups.getByRole("link", { name: group.name })).toBeVisible();
  });

  test("unauthorized identity stays on login and cannot render a selected group", async ({ page }) => {
    await page.route("**/api/v1/auth/session", async (route) => {
      await json(route, { error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    });
    await page.goto(`/portal/#/groups/${GROUP_ID}/overview`);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByText(group.name)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
