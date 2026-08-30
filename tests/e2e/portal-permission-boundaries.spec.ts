/**
 * What a permission actually buys, seen from the browser.
 *
 * Backend suites prove each guard rejects the wrong caller. What they cannot
 * show is whether the portal offers a control the caller may not use — the
 * failure mode where an action appears available and only fails on submit, or
 * worse, appears unavailable while the API still accepts it. These journeys
 * grant exactly one permission at a time and check both halves: the rendered
 * controls, and the API behind them.
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { submitMembershipApplication, transitionCard, uniqueSuffix } from "./helpers/membership";

/** Provisions a real user by taking an application all the way to approval. */
async function provisionUser(page: Page, suffix: string): Promise<{ email: string; userId: string }> {
  const email = `scoped-${suffix}@scoped-${suffix}.test`;
  const application = await submitMembershipApplication(page, {
    email,
    name: `Scoped Identity ${suffix}`,
    category: "F",
    organizationName: `Scoped Organization ${suffix}`,
  });

  await signInToPortal(page, e2eAdminEmail("portal-permission-boundaries"));
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
    return { status: response.status, body: (await response.json()) as { userId: string } };
  }, application.applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { email, userId: approved.body.userId };
}

async function grantPermission(page: Page, userId: string, permission: string): Promise<void> {
  const granted = await page.evaluate(
    async ({ userId, permission }) => {
      const response = await fetch("/api/v1/permissions/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId, permission }),
      });
      return { status: response.status, body: await response.json() };
    },
    { userId, permission },
  );
  expect(granted.status, JSON.stringify(granted.body)).toBe(201);
}

test("membership:read alone reads applications but offers and accepts no stage change", async ({ page }) => {
  const suffix = uniqueSuffix();
  page.on("dialog", (dialog) => void dialog.accept());

  const { email, userId } = await provisionUser(page, suffix);
  await grantPermission(page, userId, "membership:read");

  // A separate application for the read-only identity to look at.
  const target = await (async () => {
    await page.context().clearCookies();
    const targetSuffix = uniqueSuffix();
    const submitted = await submitMembershipApplication(page, {
      email: `read-only-target-${targetSuffix}@read-only-target-${targetSuffix}.test`,
      name: `Read Only Target ${targetSuffix}`,
      category: "F",
      organizationName: `Read Only Target Organization ${targetSuffix}`,
    });
    return submitted;
  })();

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/membership/applications");

  // Reading is exactly what the permission grants.
  const row = page.locator("tr").filter({ hasText: target.email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByText(target.name, { exact: false }).first()).toBeVisible();

  // Writing is not. The transition form must not be rendered at all, rather
  // than rendered and failing when used.
  await expect(transitionCard(page).locator("select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transition" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve & run onboarding" })).toHaveCount(0);

  // And the API behind the hidden control refuses it too, so hiding the
  // control is a convenience rather than the actual boundary.
  const rejected = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/v1/members/applications/${applicationId}/stage`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    return response.status;
  }, target.applicationId);
  expect(rejected, "a read-only identity must not move an application").toBe(403);
});

test("membership:write can move stages but cannot approve", async ({ page }) => {
  const suffix = uniqueSuffix();
  page.on("dialog", (dialog) => void dialog.accept());

  const { email, userId } = await provisionUser(page, suffix);
  await grantPermission(page, userId, "membership:read");
  await grantPermission(page, userId, "membership:write");

  await page.context().clearCookies();
  const targetSuffix = uniqueSuffix();
  const target = await submitMembershipApplication(page, {
    email: `write-target-${targetSuffix}@write-target-${targetSuffix}.test`,
    name: `Write Target ${targetSuffix}`,
    category: "F",
    organizationName: `Write Target Organization ${targetSuffix}`,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/membership/applications");
  const row = page.locator("tr").filter({ hasText: target.email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  // The transition control is available to a writer.
  await expect(transitionCard(page).locator("select").first()).toBeVisible();

  // Approval is a separate permission. Reaching ec_review through the API and
  // then attempting approval isolates that boundary from the stage boundary.
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
      { applicationId: target.applicationId, toStage },
    );
    expect(status, `a writer must be able to move to ${toStage}`).toBe(200);
  }

  const refused = await page.evaluate(async (applicationId) => {
    const response = await fetch(`/api/v1/members/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    return response.status;
  }, target.applicationId);
  expect(refused, "approval must require membership:approve").toBe(403);
});
