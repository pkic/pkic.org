import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

test("permitted staff manage organizations through the canonical domain API", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationName = `E2E Portal Organization ${suffix}`;
  const primaryEmail = `e2e-org-primary-${suffix}@example.invalid`;
  const secondaryEmail = `e2e-org-secondary-${suffix}@example.invalid`;
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/organizations")) canonicalRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/admin/organizations")) legacyRequests.push(`${request.method()} ${pathname}`);
  });

  await signInToPortal(page, e2eAdminEmail("portal-organizations"));
  await page.goto("/portal/#/organizations");

  await expect(page.getByRole("link", { name: "Organizations", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add organization", exact: true }).click();
  await page.locator("#organization-create-name").fill(organizationName);
  await page.locator("#organization-create-category").selectOption("F");
  await page.locator("#organization-create-member-since").fill("2026-01-15");
  await page.locator("#organization-create-website").fill("https://example.invalid");
  await page.locator("#organization-create-representative-name-0").fill("Primary Representative");
  await page.locator("#organization-create-representative-email-0").fill(primaryEmail);
  await page.locator("#organization-create-representative-title-0").fill("Security Engineer");

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create organization" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByText("Organization created", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(organizationName) })).toBeVisible();

  await page.getByRole("cell", { name: new RegExp(organizationName) }).click();
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
  await expect(page.getByText(primaryEmail, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add new person", exact: true }).click();
  await page.locator("#organization-representative-name").fill("Secondary Representative");
  await page.locator("#organization-representative-email").fill(secondaryEmail);
  await page.locator("#organization-representative-job-title").fill("Program Manager");
  const associateResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/representatives$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await associateResponse).status()).toBe(201);
  await expect(page.getByText(secondaryEmail, { exact: true })).toBeVisible();
  await expect(page.getByText("Program Manager", { exact: true })).toBeVisible();

  // The System Users view must read the canonical representation capacity,
  // not the legacy user-wide organization/job-title columns.
  await page.goto("/portal/#/users");
  const userSearch = page.getByPlaceholder("email or name");
  await userSearch.fill(secondaryEmail);
  await userSearch.press("Enter");
  const secondaryUserRow = page.locator("tr").filter({ hasText: secondaryEmail });
  await expect(secondaryUserRow).toContainText(organizationName);
  await secondaryUserRow.click();
  await expect(page.locator(".page-heading")).toHaveText("Secondary Representative");
  const capacityCard = page.locator(".border.rounded.p-3").filter({ hasText: organizationName });
  await expect(capacityCard).toContainText(secondaryEmail);
  await expect(capacityCard).toContainText("Program Manager");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page.locator("#user-organizationName")).toHaveCount(0);
  await expect(page.locator("#user-jobTitle")).toHaveCount(0);

  await page.goto("/portal/#/organizations");
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await expect(page.getByRole("cell", { name: new RegExp(organizationName) })).toBeVisible();

  await page.context().clearCookies();
  await signInToPortal(page, primaryEmail);
  await page.goto("/portal/#/profile");
  await expect(page.getByRole("heading", { name: "Organization representatives", exact: true })).toBeVisible();

  let representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Active");
  const removeResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/representatives\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await representativeRow.getByRole("button", { name: "Actions for Secondary Representative" }).click();
  await page.getByRole("menuitem", { name: "Remove from organization" }).click();
  await acceptConfirmDialog(page, "Remove from organization");
  expect((await removeResponse).status()).toBe(200);

  representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Removed — blocked from re-adding");
  const restoreResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/representatives\/[^/]+\/restore$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await representativeRow.getByRole("button", { name: "Actions for Secondary Representative" }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await acceptConfirmDialog(page, "Restore representative");
  expect((await restoreResponse).status()).toBe(200);

  representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Active");
  await expect(representativeRow.getByRole("button", { name: "Actions for Secondary Representative" })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/organizations",
      "POST /api/v1/organizations",
      expect.stringMatching(/^GET \/api\/v1\/organizations\/[^/]+$/),
      expect.stringMatching(/^POST \/api\/v1\/organizations\/[^/]+\/representatives$/),
      expect.stringMatching(/^DELETE \/api\/v1\/organizations\/[^/]+\/representatives\/[^/]+$/),
      expect.stringMatching(/^POST \/api\/v1\/organizations\/[^/]+\/representatives\/[^/]+\/restore$/),
    ]),
  );
  expect(legacyRequests).toEqual([]);
});
