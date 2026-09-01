import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { definitionFor } from "./helpers/definition-list";

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
  await page.getByRole("button", { name: "Add organization", exact: true }).first().click();
  // Located by the names the form announces — the region, its per-identity
  // groups, and each control's label — rather than by generated ids.
  const createForm = page.getByRole("region", { name: "Add organization" });
  await createForm.getByLabel("Organization name").fill(organizationName);
  await createForm.getByLabel("Membership category").selectOption("F");
  await createForm.getByLabel("Member since").fill("2026-01-15");
  await createForm.getByLabel("Website").fill("https://example.invalid");
  const firstIdentity = createForm.getByRole("group", { name: "Identity 1" });
  await firstIdentity.getByLabel("Name").fill("Primary Representative");
  await firstIdentity.getByLabel("Email").fill(primaryEmail);
  await firstIdentity.getByLabel("Job title").fill("Security Engineer");
  await createForm.getByLabel("Immediate activation reason").fill("E2E organization setup");

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
  // Located by the group's accessible name and each control's label rather
  // than by ids the surface used to hand out, so this keeps working the next
  // time the markup moves.
  const newPerson = page.getByRole("group", { name: "New person" });
  await newPerson.getByLabel("Name").fill("Secondary Representative");
  await newPerson.getByLabel("Email").fill(secondaryEmail);
  await newPerson.getByLabel("Job title").fill("Program Manager");
  const associateResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/identities$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  expect((await associateResponse).status()).toBe(201);
  await expect(page.getByText(secondaryEmail, { exact: true })).toBeVisible();

  // Ordinary additions are invitations. The exact user must accept before
  // this identity grants organization or group capacity or exposes its
  // organization profile fields.
  await page.context().clearCookies();
  await signInToPortal(page, secondaryEmail);
  await page.goto("/portal/#/account");
  const accepted = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/current\/identities\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Accept identity" }).click();
  expect((await accepted).status()).toBe(200);

  // The System Users view must read the canonical representation capacity,
  // not the legacy user-wide organization/job-title columns.
  await page.context().clearCookies();
  await signInToPortal(page, e2eAdminEmail("portal-organizations"));
  await page.goto("/portal/#/users");
  const userSearch = page.getByPlaceholder("email or name");
  await userSearch.fill(secondaryEmail);
  await userSearch.press("Enter");
  const secondaryUserRow = page.locator("tr").filter({ hasText: secondaryEmail });
  await expect(secondaryUserRow).toContainText("Member · 1 active identity");
  await expect(secondaryUserRow).not.toContainText(organizationName);
  await secondaryUserRow.click();
  // Located by role rather than by the class the record used to carry: the
  // user's name is a real heading now.
  await expect(page.getByRole("heading", { name: "Secondary Representative", level: 2 })).toBeVisible();
  // The acting identity is a description list, not a bordered card, so each
  // value is asserted under the label it answers rather than as text somewhere
  // inside `.border.rounded.p-3` — Bootstrap class names that are now gone.
  await expect(definitionFor(page, "Organization")).toHaveText(organizationName);
  await expect(definitionFor(page, "Identity email")).toHaveText(secondaryEmail);
  await expect(definitionFor(page, "Job title")).toHaveText("Program Manager");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page.locator("#user-organizationName")).toHaveCount(0);
  await expect(page.locator("#user-jobTitle")).toHaveCount(0);

  await page.goto("/portal/#/organizations");
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await expect(page.getByRole("cell", { name: new RegExp(organizationName) })).toBeVisible();

  await page.context().clearCookies();
  await signInToPortal(page, primaryEmail);
  await page.goto("/portal/#/profile");
  await expect(page.getByRole("heading", { name: "Organization identities", exact: true })).toBeVisible();

  let representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Active");
  const removeResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/identities\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  await representativeRow.getByRole("button", { name: "Actions for Secondary Representative" }).click();
  await page.getByRole("menuitem", { name: "End identity" }).click();
  await acceptConfirmDialog(page, "End identity");
  expect((await removeResponse).status()).toBe(200);

  representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Ended");
  await expect(representativeRow.getByRole("button", { name: "Actions for Secondary Representative" })).toHaveCount(0);

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/organizations",
      "POST /api/v1/organizations",
      expect.stringMatching(/^GET \/api\/v1\/organizations\/[^/]+$/),
      expect.stringMatching(/^POST \/api\/v1\/organizations\/[^/]+\/identities$/),
      expect.stringMatching(/^PATCH \/api\/v1\/organizations\/[^/]+\/identities\/[^/]+$/),
    ]),
  );
  expect(legacyRequests).toEqual([]);
});
