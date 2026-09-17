/**
 * @covers system.12.1
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { runRowAction } from "./helpers/data-table";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { openProfileEditor, signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { agreeToHeadshotTerms, chooseHeadshotThroughUploadButton } from "./helpers/headshot-upload";

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
   * The name is one deliberate step away, on the record's own actions menu.
   * It is not stacked under the "Account administration" disclosure — a
   * person whose name came across a migration wrong is exactly who this page
   * is opened to fix — and equally the record does not arrive already in edit
   * mode (#47), because editing is something a reader chooses to do.
   */
  /*
   * #47: the record arrives stating its facts, not offering them as fields.
   * Asserted before the editor is opened, because "does not start in edit
   * mode" is a claim about the page as it loads and nothing else here would
   * notice if it stopped being true.
   */
  const account = page.getByRole("region", { name: "Account" });
  await expect(account).toBeVisible();
  await expect(account.getByLabel("Preferred name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  /*
   * #46: the fields are edited where they are stated. Opening the editor used
   * to append a separate "Edit profile" panel further down the record, while
   * the Account card beside it went on stating the same values — the reader
   * saw one name twice and the two could disagree while the draft was open.
   * The command now turns that card's own list into that card's own fields,
   * so this asserts the field appears *inside* the Account region.
   */
  await openProfileEditor(page);
  const preferredName = account.getByLabel("Preferred name");
  await expect(preferredName).toBeVisible();
  // And nowhere else on the record: one field for one fact.
  await expect(page.getByLabel("Preferred name")).toHaveCount(1);
  const saveResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await preferredName.fill(updatedPreferredName);
  await account.getByRole("button", { name: "Save", exact: true }).click();
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
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
  await page.getByRole("menuitemradio", { name: "Members" }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Represents column options" }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
  await page.getByRole("menuitemradio", { name: "Event attendees" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Represents column options" }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
  await page.getByRole("menuitemradio", { name: "Everyone" }).click();
  await expect(row).toBeVisible();

  // "Role" column filter — narrowing to "Users" still shows the row (its
  // role is the plain default); narrowing to "Administrators" hides it.
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
  await page.getByRole("menuitemradio", { name: "Users" }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
  await page.getByRole("menuitemradio", { name: "Administrators" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Role column options" }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
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

  /*
   * #36: a row's menu opens AT the "…" that opened it.
   *
   * Measured, not merely reached. Every assertion above finds its menu by
   * role and passes wherever the popup happens to be drawn, which is why this
   * survived being "fixed" twice: the popup was opening hundreds of pixels
   * away — off the right of the viewport in a wide table — while every
   * role-based assertion in the suite went on passing.
   *
   * The cause was a stacking rule on clickable rows that lifted the row's
   * interactive children with `position: relative`, and named `[role="menu"]`
   * among them. That is the popup, not the trigger, and the selector outranked
   * `.pk-menu__popup { position: fixed }` — so the viewport coordinates the
   * placement writes were read as offsets from the popup's static spot in the
   * row. It only ever happened in tables whose rows activate something, which
   * is what "not fixed in all tables" meant.
   */
  const trigger = row.getByRole("button", { name: /^Actions for/ });
  await trigger.click();
  const popup = page.getByRole("menu");
  await expect(popup).toBeVisible();

  const anchor = (await trigger.boundingBox())!;
  const margin = 8;
  /*
   * End-aligned with the trigger, or held at the viewport's margin when the
   * trigger has been scrolled past the right edge — that is the whole policy,
   * stated rather than approximated. A tolerance loose enough to be safe is
   * loose enough to accept a menu nobody would call anchored.
   */
  const expectedRight = Math.min(anchor.x + anchor.width, (page.viewportSize()?.width ?? 1280) - margin);

  const read = () =>
    popup.evaluate(
      (menu, viewport) => {
        const rect = menu.getBoundingClientRect();
        return {
          position: getComputedStyle(menu).position,
          top: rect.top,
          right: rect.right,
          insideViewport:
            rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height,
        };
      },
      page.viewportSize() ?? { width: 1280, height: 720 },
    );

  /*
   * Polled, because settling is the behaviour under test: the popup places
   * itself before paint and corrects on the next frame once fonts and column
   * widths stop moving. What a reader must never see is a menu that stays put
   * in the wrong place.
   */
  await expect.poll(async () => (await read()).right, { timeout: 5_000 }).toBeCloseTo(expectedRight, 0);

  const placement = await read();
  // It stays out of the row's stacking context, which is the whole reason it
  // can hang over a table with `overflow: auto`.
  expect(placement.position).toBe("fixed");
  // Wholly on screen: the failure mode was a menu drawn where nobody could
  // reach it.
  expect(placement.insideViewport).toBe(true);
  // And hanging from its own trigger rather than from somewhere else on the page.
  expect(Math.abs(placement.top - (anchor.y + anchor.height))).toBeLessThan(12);
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

  /*
   * The portrait is the control, in the open at the top of the record (#28).
   * It used to be an upload button behind the "Account administration"
   * disclosure, which is what the issue objected to: a photograph is not
   * administration, and nobody looks for their own face under that heading.
   *
   * Through the tile and the picker it opens: reaching past it to the input is
   * what let #28 hide here before. See helpers/headshot-upload.ts.
   */
  await expect(page.getByRole("button", { name: "Account administration", exact: true })).toHaveCount(1);
  await chooseHeadshotThroughUploadButton(page);

  const crop = await agreeToHeadshotTerms(page);
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
  const frame = page.getByRole("button", { name: "Change photo", exact: true });
  const frameBox = (await frame.boundingBox())!;
  const imageBox = (await portrait.boundingBox())!;
  expect(Math.abs(imageBox.width - imageBox.height), "photo stays square").toBeLessThan(1);
  expect(Math.abs(frameBox.width - imageBox.width), "photo fills its circular frame").toBeLessThanOrEqual(2);
  await expect(portrait).toHaveCSS("object-fit", "cover");
  // #85: the standing must surround only the photo, never editor actions.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const ring = page.locator(".pk-avatar-standing__ring").filter({ has: frame });
    const ringBox = (await ring.boundingBox())!;
    const pictureBox = (await frame.boundingBox())!;
    expect(Math.abs(ringBox.width - ringBox.height), "standing stays circular").toBeLessThan(1);
    expect(ringBox.width - pictureBox.width, "ring hugs the photo").toBeCloseTo(6, 0);
    await expect(ring.getByRole("button", { name: "Remove photo", exact: true })).toHaveCount(0);
    await frame.focus();
    await expect(page.getByRole("button", { name: "Remove photo", exact: true })).toBeVisible();
    const badge = page.locator(".pk-avatar-standing").filter({ has: frame }).locator(".pk-avatar-standing__label");
    expect(
      await badge.evaluate((label) => {
        const box = label.getBoundingClientRect();
        return label.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 2));
      }),
      "badge paints above the photo where they overlap",
    ).toBe(true);
    const removeBox = (await page.getByRole("button", { name: "Remove photo", exact: true }).boundingBox())!;
    expect(removeBox.y, "remove is at the portrait corner, not a separate row").toBeLessThan(pictureBox.y + 10);
    await page.screenshot({ path: `test-results/issue-85-portrait-${width}.png` });
  }
});
