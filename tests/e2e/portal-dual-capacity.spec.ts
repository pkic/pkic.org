/**
 * One person representing two organizations.
 *
 * The matrix asks that a dual-capacity identity receive both valid portal
 * contexts and be able to switch between them. The switch endpoint re-verifies
 * the requested membership against the caller's own live eligibility, which is
 * the part worth proving in a browser: a context the caller does not hold must
 * be refused even though the request is well formed and the session is valid.
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
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

/** Approves an application for `email`, creating a real member and user. */
async function approveMemberFor(page: Page, email: string, organizationName: string): Promise<void> {
  const application = await submitMembershipApplication(page, {
    email,
    name: `Dual Capacity ${organizationName}`,
    category: "F",
    organizationName,
  });
  for (const toStage of ["in_review", "in_consultation", "ec_review"]) {
    const status = await page.evaluate(
      async ({ applicationId, toStage }) => {
        const response = await fetch(`/api/v1/members/applications/${applicationId}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage }),
        });
        return response.status;
      },
      { applicationId: application.applicationId, toStage },
    );
    expect(status).toBe(200);
  }
  const approved = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/v1/members/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    return { status: response.status, body: await response.json() };
  }, application.applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
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

  await page.context().clearCookies();
  await signInToPortal(page, email);

  const profile = await readProfile(page);
  const names = profile.activeIdentities.map((identity) => identity.organizationName);
  expect(names, JSON.stringify(profile.activeIdentities)).toContain(firstOrganization);
  expect(names).toContain(secondOrganization);

  // Switching must actually change the acting context, not just report success.
  const target = profile.activeIdentities.find((identity) => identity.organizationName !== profile.organizationName);
  expect(target, "a second distinct context must exist to switch to").toBeTruthy();

  await page.goto("/portal/#/profile");
  // The record opens with the member, not a page title: ProfileHeader names
  // the subject, and the sidebar had already said where we are.
  await expect(page.locator(".pk-profile-header h2")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Job title for this organization", exact: true })
    .fill("Security lead in the first capacity");
  await page
    .getByRole("textbox", { name: "Biography", exact: true })
    .fill("Biography written only for the first represented organization.");
  await page
    .getByRole("textbox", { name: "Social / profile links", exact: true })
    .fill("https://example.test/first-capacity");
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Save changes" }).click(),
  ]);

  const targetCapacity = page.getByRole("listitem").filter({ hasText: target!.organizationName! });
  const switched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/users/current/identities/active") && response.request().method() === "PUT",
  );
  await targetCapacity.getByRole("button", { name: "Switch" }).click();
  expect((await switched).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "Job title for this organization", exact: true })).toHaveValue(
    "Delegate",
  );

  const after = await readProfile(page);
  expect(after.organizationName).toBe(target!.organizationName);
  // Switching context must not cost the other capacity.
  expect(after.activeIdentities.map((identity) => identity.organizationName)).toEqual(expect.arrayContaining(names));

  await page
    .getByRole("textbox", { name: "Job title for this organization", exact: true })
    .fill("Program chair in the second capacity");
  await page
    .getByRole("textbox", { name: "Biography", exact: true })
    .fill("A different biography for the second represented organization.");
  await page
    .getByRole("textbox", { name: "Social / profile links", exact: true })
    .fill("https://example.test/second-capacity");
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
    ),
    page.getByRole("button", { name: "Save changes" }).click(),
  ]);
  expect(await readProfile(page)).toMatchObject({
    jobTitle: "Program chair in the second capacity",
    biography: "A different biography for the second represented organization.",
    links: ["https://example.test/second-capacity"],
  });

  const firstCapacity = page.getByRole("listitem").filter({ hasText: profile.organizationName! });
  const switchedBack = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/users/current/identities/active") && response.request().method() === "PUT",
  );
  await firstCapacity.getByRole("button", { name: "Switch" }).click();
  expect((await switchedBack).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "Job title for this organization", exact: true })).toHaveValue(
    "Security lead in the first capacity",
  );
  await expect(page.getByRole("textbox", { name: "Biography", exact: true })).toHaveValue(
    "Biography written only for the first represented organization.",
  );
  await expect(page.getByRole("textbox", { name: "Social / profile links", exact: true })).toHaveValue(
    "https://example.test/first-capacity",
  );
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
