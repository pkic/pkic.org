import { completeSyntheticMembershipReview } from "./helpers/member-provisioning";
/**
 * One person representing two organizations.
 *
 * The matrix asks that a dual-capacity identity receive both valid portal
 * contexts and be able to switch between them. The switch endpoint re-verifies
 * the requested membership against the caller's own live eligibility, which is
 * the part worth proving in a browser: a context the caller does not hold must
 * be refused even though the request is well formed and the session is valid.
 * Holding both, the person chooses one on arrival and switches from the
 * account menu.
 * @covers account.7.9
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { editMyIdentityProfile, openMyProfile, signInToPortal } from "./helpers/portal-auth";
import { submitMembershipApplication, uniqueSuffix } from "./helpers/membership";

interface Profile {
  organizationName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
  activeIdentities: Array<{ identityId: string; memberId: string; organizationName: string | null }>;
}

async function readProfile(page: Page): Promise<Profile> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/users/current", { credentials: "same-origin" });
    return { status: response.status, body: (await response.json()) as Profile };
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}

/** Switches the acting identity the way a person does: from the account menu, which reloads the portal. */
async function switchIdentityFromMenu(page: Page, organizationName: string): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Switch identity" }).click();
  const switched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/users/current/identities/active") && response.request().method() === "PUT",
  );
  await page.getByRole("menuitemradio", { name: new RegExp(organizationName) }).click();
  expect((await switched).status()).toBe(200);
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText(`Acting as ${organizationName}`)).toBeVisible();
  await page.keyboard.press("Escape");
}

function biographyEditor(page: Page) {
  return page.getByRole("textbox", { name: /^Your bio at / });
}

/** Fills the identity profile page that is open and saves it through the form's own button. */
async function saveIdentityProfile(
  page: Page,
  values: { jobTitle: string; biography: string; link: string },
): Promise<void> {
  await page.getByRole("textbox", { name: /^Job title for this organization/ }).fill(values.jobTitle);
  await biographyEditor(page).fill(values.biography);
  await page.getByRole("textbox", { name: "Profile link URL", exact: true }).fill(values.link);
  await page.getByRole("button", { name: "Add profile link", exact: true }).click();
  await expect(page.getByRole("group", { name: "Added profile links" })).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/current\/identities\/[^/]+\/profile$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).status()).toBe(200);
  // Saving returns the person to their record.
  await expect(page).toHaveURL(/\/portal\/#\/users\/[^/?#]+$/, { timeout: 15_000 });
}

/** Approves an application for `email`, creating a real member and user. */
async function approveMemberFor(page: Page, email: string, organizationName: string): Promise<void> {
  const application = await submitMembershipApplication(page, {
    email,
    name: `Dual Capacity ${organizationName}`,
    category: "F",
    organizationName,
  });
  await completeSyntheticMembershipReview(page.request, application.applicationId);
}

test("a person representing two organizations can switch between both contexts", async ({ page }) => {
  const suffix = uniqueSuffix();
  const domain = `dual-${suffix}.test`;
  const email = `dual-${suffix}@${domain}`;
  const firstOrganization = `Dual Capacity First ${suffix}`;
  const secondOrganization = `Dual Capacity Second ${suffix}`;
  page.on("dialog", (dialog) => void dialog.accept());

  const staffEmail = e2eAdminEmail("portal-dual-capacity");
  await signInToPortal(page, staffEmail);
  await approveMemberFor(page, email, firstOrganization);

  // A second organization records another approved identity for the same
  // person, which is how a real second capacity arises.
  const created = await page.evaluate(
    async ({ organizationName, email }) => {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: organizationName,
          membershipCategory: "F",
          memberSince: "2026-01-15",
          identities: [{ name: "Dual Capacity Rep", email, jobTitle: "Delegate" }],
          activationReason: "E2E dual-identity coverage",
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { organizationName: secondOrganization, email },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  // Holding both, the person is asked which one to continue as on arrival.
  await page.context().clearCookies();
  await signInToPortal(page, email, { continueAs: firstOrganization });

  const profile = await readProfile(page);
  expect(profile.organizationName).toBe(firstOrganization);
  const names = profile.activeIdentities.map((identity) => identity.organizationName);
  expect(names, JSON.stringify(profile.activeIdentities)).toContain(firstOrganization);
  expect(names).toContain(secondOrganization);

  // Switching must actually change the acting context, not just report success.
  const target = profile.activeIdentities.find((identity) => identity.organizationName !== profile.organizationName);
  expect(target, "a second distinct context must exist to switch to").toBeTruthy();

  // The identity-scoped fields live on the person's own record — the same
  // page anybody else's record is — and switching which identity the portal
  // acts as is a session setting, so it lives in the account menu. The walk
  // below moves between the two the way a member does.
  await openMyProfile(page);
  // The professional profile opens with the member, not a page title: its heading names the subject.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await editMyIdentityProfile(page, firstOrganization);
  await saveIdentityProfile(page, {
    jobTitle: "Security lead in the first capacity",
    biography: "Biography written only for the first represented organization.",
    link: "https://example.test/first-capacity",
  });

  await switchIdentityFromMenu(page, target!.organizationName!);

  await openMyProfile(page);
  await editMyIdentityProfile(page, target!.organizationName!);
  await expect(page.getByRole("textbox", { name: /^Job title for this organization/ })).toHaveValue("Delegate");
  // The other capacity's biography and links did not follow the switch.
  await expect(biographyEditor(page)).toHaveText("");
  await expect(page.getByRole("group", { name: "Added profile links" })).toHaveCount(0);

  const after = await readProfile(page);
  expect(after.organizationName).toBe(target!.organizationName);
  // Switching context must not cost the other capacity.
  expect(after.activeIdentities.map((identity) => identity.organizationName)).toEqual(expect.arrayContaining(names));

  await saveIdentityProfile(page, {
    jobTitle: "Program chair in the second capacity",
    biography: "A different biography for the second represented organization.",
    link: "https://example.test/second-capacity",
  });
  expect(await readProfile(page)).toMatchObject({
    jobTitle: "Program chair in the second capacity",
    biography: "A different biography for the second represented organization.",
    links: ["https://example.test/second-capacity"],
  });

  await switchIdentityFromMenu(page, profile.organizationName!);

  await openMyProfile(page);
  await editMyIdentityProfile(page, firstOrganization);
  await expect(page.getByRole("textbox", { name: /^Job title for this organization/ })).toHaveValue(
    "Security lead in the first capacity",
  );
  // The biography is a Markdown editor: its text, not a value.
  await expect(biographyEditor(page)).toHaveText("Biography written only for the first represented organization.");
  // Links are added one at a time; the saved one comes back as an added link.
  await expect(page.getByRole("group", { name: "Added profile links" })).toContainText("example.test");
  expect(await readProfile(page)).toMatchObject({ links: ["https://example.test/first-capacity"] });
});

test("a membership the caller does not hold cannot be selected", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `single-capacity-${suffix}@single-capacity-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-dual-capacity-guard"));
  await approveMemberFor(page, email, `Single Capacity Organization ${suffix}`);

  // A real member id belonging to somebody else.
  const otherEmail = `other-capacity-${suffix}@other-capacity-${suffix}.test`;
  await approveMemberFor(page, otherEmail, `Other Capacity Organization ${suffix}`);

  await page.context().clearCookies();
  await signInToPortal(page, otherEmail);
  const otherProfile = await readProfile(page);
  const foreignIdentityId = otherProfile.activeIdentities[0].identityId;

  await page.context().clearCookies();
  await signInToPortal(page, email);
  const refused = await page.evaluate(async (identityId) => {
    const response = await fetch("/api/v1/users/current/identities/active", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ identityId }),
    });
    return response.status;
  }, foreignIdentityId);
  expect(refused, "a caller must not select an identity they do not hold").toBe(403);
});
