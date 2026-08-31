import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { extractEmailUrl, capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import { signInToPortal } from "./helpers/portal-auth";

/**
 * Real Worker/D1 persona coverage for the selected-group portal boundary.
 *
 * The synthetic companion (`portal-personas.spec.ts`) remains the fast shell
 * contract. This file deliberately uses only the public HTTP APIs and the
 * normal mailbox capability flow: no route interception, no D1 files, and no
 * shared interceptor clearing. It creates disposable groups and an approved
 * member in the fresh D1 started by the Playwright webServer.
 */
test.describe.configure({ mode: "serial" });

const PARENT_NAME = "E2E Persona Parent";
const INHERITED_CHILD_NAME = "E2E Persona Inherited Child";
const LOCAL_ONLY_CHILD_NAME = "E2E Persona Local Child";

type JsonRecord = Record<string, unknown>;

function stringProperty(payload: JsonRecord, key: string): string {
  const value = payload[key];
  expect(typeof value, `Expected ${key} to be a string in ${JSON.stringify(payload)}`).toBe("string");
  return value as string;
}

function recordProperty(payload: JsonRecord, key: string): JsonRecord {
  const value = payload[key];
  expect(value, `Expected ${key} in ${JSON.stringify(payload)}`).toBeTruthy();
  return value as JsonRecord;
}

function arrayProperty(payload: JsonRecord, key: string): unknown[] {
  const value = payload[key];
  expect(Array.isArray(value), `Expected ${key} to be an array in ${JSON.stringify(payload)}`).toBe(true);
  return value as unknown[];
}

async function jsonResponse(
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<JsonRecord> {
  const response = await request.fetch(path, {
    method,
    ...(body === undefined ? {} : { data: body }),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
  const payload = (await response.json()) as JsonRecord;
  expect(response.status(), `${method} ${path}: ${JSON.stringify(payload)}`).toBeLessThan(300);
  return payload;
}

async function createMember(
  page: Page,
): Promise<{ email: string; userId: string; memberId: string; identityId: string }> {
  const identity = crypto.randomUUID();
  const email = `e2e-persona-${identity}@persona-${identity}.example.test`;
  const startSince = await capturedEmailCount();
  const start = await jsonResponse(page.request, "POST", "/api/v1/members/join/start", {
    email,
    unaffiliatedAttestation: false,
  });
  expect(stringProperty(start, "status")).toBe("verification_sent");

  const verificationEmail = await waitForCapturedEmail(email, "verify your email address", { since: startSince });
  const verificationUrl = extractEmailUrl(verificationEmail, "/join/");
  const verificationToken = new URL(verificationUrl).hash.replace(/^#verify=/, "");
  expect(verificationToken.length).toBeGreaterThan(32);
  const verified = await jsonResponse(page.request, "POST", "/api/v1/members/join/verify", {
    token: verificationToken,
  });
  expect(stringProperty(verified, "status")).toBe("application_ready");

  const application = await jsonResponse(page.request, "POST", "/api/v1/members/applications", {
    applicantEmail: email,
    applicantName: "E2E Persona Member",
    membershipCategory: "A",
    organizationName: `Persona Test Organization ${identity}`,
    joinToken: stringProperty(verified, "joinToken"),
    answers: {
      reason: "Real Worker/D1 portal persona coverage",
      agrees_bylaws: true,
      agrees_code_of_conduct: true,
      agrees_ipr_policy: true,
      warranted_authority: true,
    },
  });
  expect(stringProperty(application, "stage")).toBe("pending");

  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "in_review",
    },
  );
  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "in_consultation",
    },
  );
  await jsonResponse(
    page.request,
    "PATCH",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/stage`,
    {
      toStage: "ec_review",
    },
  );
  const approved = await jsonResponse(
    page.request,
    "POST",
    `/api/v1/members/applications/${stringProperty(application, "applicationId")}/approve`,
  );
  const userId = stringProperty(approved, "userId");
  const userDetail = recordProperty(await jsonResponse(page.request, "GET", `/api/v1/users/${userId}`), "user");
  const identities = arrayProperty(userDetail, "identities");
  expect(identities).toHaveLength(1);
  return {
    email,
    userId,
    memberId: stringProperty(approved, "memberId"),
    identityId: stringProperty(identities[0] as JsonRecord, "identityId"),
  };
}

async function createGroup(
  request: APIRequestContext,
  name: string,
  slug: string,
  parentGroupId: string | null,
  governanceInheritanceMode?: "inherited" | "local_only",
): Promise<JsonRecord> {
  const body = await jsonResponse(request, "POST", "/api/v1/groups", {
    typeKey: "working_group",
    name,
    slug,
    parentGroupId,
    governanceInheritanceMode,
    eligibilityMode: "open",
    visibility: "authenticated",
  });
  return recordProperty(body, "group");
}

/** Create a real staff identity, then detach its membership before granting scoped group permissions. */
async function createStaffOnly(page: Page, groupIds: string[], stamp: string): Promise<string> {
  const email = `e2e-staff-${stamp}@persona.example.test`;
  const created = await jsonResponse(page.request, "POST", "/api/v1/members", {
    organizationName: `Staff Persona Organization ${stamp}`,
    membershipCategory: "A",
    memberSince: "2026-08-01",
    identities: [{ name: "E2E Staff Persona", email }],
    activationReason: "E2E staff persona setup",
    workingGroupSlugs: [],
  });
  const members = arrayProperty(created, "members");
  expect(members).toHaveLength(1);
  const member = members[0] as JsonRecord;
  const userId = stringProperty(member, "userId");
  const membershipId = stringProperty(member, "id");

  // The DELETE is the real membership-capacity offboarding API. It ends the
  // membership and leaves the active identity available for scoped staff
  // access, rather than pretending the global admin is a staff persona.
  await jsonResponse(page.request, "DELETE", `/api/v1/members/capacities/${membershipId}`);
  for (const groupId of groupIds) {
    for (const permission of ["groups:read", "groups:write"]) {
      await jsonResponse(page.request, "POST", "/api/v1/permissions/grants", {
        userId,
        permission,
        contextType: "group",
        contextId: groupId,
      });
    }
  }
  return email;
}

async function assertGroupCapabilities(page: Page, groupId: string, expected: string[]): Promise<void> {
  const response = await page.request.get(`/api/v1/groups/${groupId}`);
  const body = (await response.json()) as JsonRecord;
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.capabilities).toEqual(expected);
}

async function openGroupAndReadNavigation(page: Page, groupId: string, groupName: string): Promise<void> {
  await page.goto(`/portal/#/groups/${groupId}/overview`);
  await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
  await expect(page.getByRole("navigation", { name: `${groupName} sections` })).toBeVisible();
}

function groupNavigation(page: Page, groupName: string) {
  return page.getByRole("navigation", { name: `${groupName} sections` });
}

async function anonymousDenied(browser: Browser, groupId: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.get(`/api/v1/groups/${groupId}`);
  expect(response.status()).toBe(404);
  await page.goto(`/portal/#/groups/${groupId}/overview`);
  await expect(page.locator("#portal-inp-email")).toBeVisible();
  await context.close();
}

test("real Worker/D1 sessions resolve member, inherited, local-only, staff, and anonymous personas", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminEmail = e2eAdminEmail("portal-event");
  await signInToPortal(adminPage, adminEmail);

  const stamp = `${Date.now()}-${test.info().workerIndex}`;
  const member = await createMember(adminPage);
  const parent = await createGroup(adminPage.request, PARENT_NAME, `e2e-persona-parent-${stamp}`, null);
  const inheritedChild = await createGroup(
    adminPage.request,
    INHERITED_CHILD_NAME,
    `e2e-persona-inherited-${stamp}`,
    stringProperty(parent, "id"),
  );
  const localOnlyChild = await createGroup(
    adminPage.request,
    LOCAL_ONLY_CHILD_NAME,
    `e2e-persona-local-${stamp}`,
    stringProperty(parent, "id"),
  );
  const localLeader = await createMember(adminPage);
  for (const groupId of [stringProperty(parent, "id"), stringProperty(localOnlyChild, "id")]) {
    await jsonResponse(adminPage.request, "POST", `/api/v1/groups/${groupId}/memberships/${localLeader.userId}`, {
      capacitySelection: { mode: "selected", memberIds: [localLeader.memberId] },
    });
  }
  await jsonResponse(adminPage.request, "POST", `/api/v1/groups/${stringProperty(localOnlyChild, "id")}/leadership`, {
    userId: localLeader.userId,
    identityId: localLeader.identityId,
    roleId: "role-group_lead",
  });
  const scopedStaffEmail = await createStaffOnly(
    adminPage,
    [stringProperty(parent, "id"), stringProperty(localOnlyChild, "id")],
    stamp,
  );
  await jsonResponse(adminPage.request, "PATCH", `/api/v1/groups/${stringProperty(localOnlyChild, "id")}`, {
    expectedRevision: localOnlyChild.revision,
    governanceInheritanceMode: "local_only",
  });

  for (const groupId of [
    stringProperty(parent, "id"),
    stringProperty(inheritedChild, "id"),
    stringProperty(localOnlyChild, "id"),
  ]) {
    await jsonResponse(adminPage.request, "POST", `/api/v1/groups/${groupId}/memberships/${member.userId}`, {
      capacitySelection: { mode: "selected", memberIds: [member.memberId] },
    });
  }
  await jsonResponse(adminPage.request, "POST", `/api/v1/groups/${stringProperty(parent, "id")}/leadership`, {
    userId: member.userId,
    identityId: member.identityId,
    roleId: "role-group_lead",
  });

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signInToPortal(memberPage, member.email);

  // The member is a direct manager of the parent, and inherited leadership
  // grants management on the inherited child without duplicating a role.
  await assertGroupCapabilities(memberPage, stringProperty(parent, "id"), ["view", "participate", "manage"]);
  await assertGroupCapabilities(memberPage, stringProperty(inheritedChild, "id"), ["view", "participate", "manage"]);
  await openGroupAndReadNavigation(memberPage, stringProperty(parent, "id"), PARENT_NAME);
  await expect(groupNavigation(memberPage, PARENT_NAME).getByRole("link", { name: "Settings" })).toBeVisible();
  await openGroupAndReadNavigation(memberPage, stringProperty(inheritedChild, "id"), INHERITED_CHILD_NAME);
  await expect(groupNavigation(memberPage, INHERITED_CHILD_NAME).getByRole("link", { name: "Settings" })).toBeVisible();

  // Local-only is a real governance boundary: the same parent leader remains
  // an ordinary participating member here unless separately assigned locally.
  await assertGroupCapabilities(memberPage, stringProperty(localOnlyChild, "id"), ["view", "participate"]);
  await openGroupAndReadNavigation(memberPage, stringProperty(localOnlyChild, "id"), LOCAL_ONLY_CHILD_NAME);
  const localOnlyNavigation = groupNavigation(memberPage, LOCAL_ONLY_CHILD_NAME);
  await expect(localOnlyNavigation.getByRole("link", { name: "Events" })).toBeVisible();
  await expect(localOnlyNavigation.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // A distinct staff identity, with no membership capacity, can enter the
  // portal through explicit contextual group permissions.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signInToPortal(staffPage, scopedStaffEmail);
  await assertGroupCapabilities(staffPage, stringProperty(parent, "id"), ["view", "manage"]);
  await openGroupAndReadNavigation(staffPage, stringProperty(parent, "id"), PARENT_NAME);
  await expect(groupNavigation(staffPage, PARENT_NAME).getByRole("link", { name: "Settings" })).toBeVisible();
  await assertGroupCapabilities(staffPage, stringProperty(localOnlyChild, "id"), ["view", "manage"]);

  // The seeded global admin is also useful as a control: its global role can
  // manage any group, but is intentionally not used as the staff-only test.
  await assertGroupCapabilities(adminPage, stringProperty(parent, "id"), ["view", "manage"]);
  await openGroupAndReadNavigation(adminPage, stringProperty(parent, "id"), PARENT_NAME);
  await expect(groupNavigation(adminPage, PARENT_NAME).getByRole("link", { name: "Settings" })).toBeVisible();

  await anonymousDenied(browser, stringProperty(parent, "id"));
  await staffContext.close();
  await memberContext.close();
  await adminContext.close();
});
