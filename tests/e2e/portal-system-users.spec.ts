/**
 * @covers system.12.1
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { runRowAction } from "./helpers/data-table";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

/** A one-pixel JPEG: enough to be a real image without carrying one around. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

test("permitted staff manage users through the canonical domain API", async ({ page }) => {
  const staffEmail = e2eAdminEmail("portal-users");
  const updatedPreferredName = `E2E Portal User ${crypto.randomUUID().slice(0, 8)}`;
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/users")) canonicalRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/admin/users") || pathname.startsWith("/api/v1/admin/members")) {
      legacyRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/users");

  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();
  const search = page.getByPlaceholder("email or name");
  await search.fill(staffEmail);
  await search.press("Enter");
  const staffRow = page.locator("tr").filter({ hasText: staffEmail });
  await expect(staffRow).toBeVisible();
  await staffRow.click();
  // Located by role, not by the class the record used to carry: the name is a
  // real heading now, and a role locator survives the next restyle too.
  await expect(page.getByRole("heading", { name: staffEmail, level: 2 })).toBeVisible();

  /*
   * The name is reachable without opening anything. It is the record's own
   * title, and a person whose name came across a migration wrong is exactly
   * who this page is opened to fix — so it must not sit behind a disclosure
   * somebody has to know about.
   */
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const preferredName = page.getByLabel("Preferred name");
  const saveResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await preferredName.fill(updatedPreferredName);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText(updatedPreferredName, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(updatedPreferredName, { exact: true })).toBeVisible();

  await page.goto("/portal/#/users");
  await expect(page).toHaveURL(/\/portal\/#\/users$/);
  await expect(page.getByRole("link", { name: "Users", exact: true })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/users",
      expect.stringMatching(/^GET \/api\/v1\/users\/[^/]+$/),
      expect.stringMatching(/^PATCH \/api\/v1\/users\/[^/]+$/),
    ]),
  );
  expect(legacyRequests).toEqual([]);
});

/**
 * A separate, non-admin user to filter and grant/revoke through — created
 * through the real organizations API (as setup, not the behavior under
 * test) so the row this test drives through the UI starts as an ordinary
 * "Members" / "User" row rather than the signed-in admin's own record.
 */
async function createNonAdminUser(page: import("@playwright/test").Page, suffix: string) {
  const email = `e2e-users-list-${suffix}@example.invalid`;
  const organizationName = `E2E Users List Org ${suffix}`;
  const created = await page.evaluate(
    async ({ email, organizationName }) => {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: organizationName,
          membershipCategory: "F",
          memberSince: "2026-01-15",
          identities: [{ name: "Users List Fixture", email, jobTitle: "Fixture Contact" }],
          workingGroupSlugs: [],
          activationReason: "E2E users-list filter/admin-role fixture",
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { email, organizationName },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { email, organizationName };
}

test("permitted staff filter, sort, and manage columns in the users list", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  await signInToPortal(page, e2eAdminEmail("portal-users"));
  const { email, organizationName } = await createNonAdminUser(page, suffix);

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();
  // The "Represents" cell names the organization, not the "Members" category
  // it belongs to — "Members" is the filter menu's option label for that
  // category, not text the cell itself ever renders.
  await expect(row).toContainText(organizationName);
  await expect(row.getByText("User", { exact: true })).toBeVisible();

  // "Represents" column filter — narrowing to "Members" still shows the row;
  // narrowing to "Event attendees" hides it.
  await page.getByRole("button", { name: "Represents column options" }).click();
  await page.getByRole("menuitemradio", { name: "Members" }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Represents column options" }).click();
  await page.getByRole("menuitemradio", { name: "Event attendees" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Represents column options" }).click();
  await page.getByRole("menuitemradio", { name: "Everyone" }).click();
  await expect(row).toBeVisible();

  // "Role" column filter — narrowing to "Users" still shows the row (its
  // role is the plain default); narrowing to "Administrators" hides it.
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitemradio", { name: "Users" }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitemradio", { name: "Administrators" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitemradio", { name: "All roles" }).click();
  await expect(row).toBeVisible();

  // Column visibility — hiding "Since" drops the column header and shows it
  // again once re-checked, without losing the row underneath it.
  await expect(page.getByRole("columnheader", { name: "Since" })).toBeVisible();
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitemradio", { name: "Since" }).click();
  await expect(page.getByRole("columnheader", { name: "Since" })).toHaveCount(0);
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitemradio", { name: "Since" }).click();
  await expect(page.getByRole("columnheader", { name: "Since" })).toBeVisible();
});

test("permitted staff grant and revoke the administrator role from a user list row", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  await signInToPortal(page, e2eAdminEmail("portal-users"));
  const { email } = await createNonAdminUser(page, suffix);

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();

  const grantResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await runRowAction(page, row, "Grant administrator role");
  await acceptConfirmDialog(page, "Grant administrator role");
  expect((await grantResponse).status()).toBe(200);
  await expect(row.getByText("Administrator", { exact: true })).toBeVisible();

  const revokeResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await runRowAction(page, row, "Revoke administrator role");
  await acceptConfirmDialog(page, "Revoke administrator role");
  expect((await revokeResponse).status()).toBe(200);
  await expect(row.getByText("Administrator", { exact: true })).toHaveCount(0);
  await expect(row.getByText("User", { exact: true })).toBeVisible();
});

/*
 * Staff putting a photograph on somebody else's record.
 *
 * The member's own upload has been walked for a while; the staff one never
 * was, and it was reported as simply not working. Both run the same controller
 * and the same two dialogs, but through a different manager and a different
 * endpoint, so the coverage of one said nothing about the other.
 */
test("staff upload a photograph onto a user record", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `staff-headshot-${suffix}@staff-headshot-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-user-headshot"));
  await approveMemberThroughReview(page, {
    email,
    name: `Staff Headshot ${suffix}`,
    organizationName: `Staff Headshot Org ${suffix}`,
  });

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.click();

  // The photograph is administration, so it sits behind the disclosure.
  await page.getByRole("button", { name: "Account administration", exact: true }).click();
  await page.getByRole("button", { name: "Upload headshot" }).click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: "headshot.jpg",
    mimeType: "image/jpeg",
    buffer: TINY_JPEG,
  });

  const disclaimer = page.getByRole("dialog", { name: "Before uploading a photo" });
  await expect(disclaimer).toBeVisible({ timeout: 10_000 });
  await disclaimer.locator(".hsd-agree").check();
  await disclaimer.locator(".hsd-confirm").click();

  const crop = page.getByRole("dialog", { name: "Crop headshot" });
  await expect(crop).toBeVisible({ timeout: 10_000 });
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/[^/]+\/headshot$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  /*
   * And the portal shows it back, which is the half that was reported as
   * working publicly but not here. Two projections serve the same photograph:
   * the record's own detail builds the staff-only `/headshot` path, the users
   * list builds the public `/headshots/{file}` one — so the assertion accepts
   * either rather than pinning the reader to one of them.
   */
  const portrait = page.locator('img[src*="/headshot"]').first();
  await expect(portrait).toBeVisible({ timeout: 15_000 });
  // Visible is not the same as loaded: a broken image still occupies its box,
  // and a 404 from the image endpoint is exactly the reported symptom.
  await expect
    .poll(async () => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
});
