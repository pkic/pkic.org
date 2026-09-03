import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { runRowAction } from "./helpers/data-table";

const LEADERSHIP_API = "/api/v1/leadership/positions";
const REMOVED_SYSTEM_LEADERSHIP_API = "/api/v1/system/leadership-positions";
const REMOVED_ADMIN_LEADERSHIP_API = "/api/v1/admin/leadership-positions";

test("permitted staff manage the public leadership roster through the System portal", async ({ page }) => {
  const systemRequests: string[] = [];
  const removedSystemRequests: string[] = [];
  const removedAdminRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === LEADERSHIP_API || pathname.startsWith(`${LEADERSHIP_API}/`)) {
      systemRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_SYSTEM_LEADERSHIP_API || pathname.startsWith(`${REMOVED_SYSTEM_LEADERSHIP_API}/`)) {
      removedSystemRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_ADMIN_LEADERSHIP_API || pathname.startsWith(`${REMOVED_ADMIN_LEADERSHIP_API}/`)) {
      removedAdminRequests.push(`${request.method()} ${pathname}`);
    }
  });

  const staffEmail = e2eAdminEmail("portal-leadership");
  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/system/leadership");
  await expect(page.getByRole("link", { name: "Leadership" })).toBeVisible();

  // The panel names itself, so the roster is addressed as a named region
  // rather than by the framework class its markup used to carry.
  const boardCard = page.getByRole("region", { name: "Board of Directors" });
  const title = `Browser-test Board Member ${Date.now()}`;
  await boardCard.getByPlaceholder("Search by email or name…").fill(staffEmail);
  await boardCard.getByRole("button", { name: new RegExp(staffEmail, "i") }).click();
  await boardCard.getByLabel("Title").fill(title);
  await boardCard.getByLabel("From").fill("2026-08-28");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === LEADERSHIP_API && response.request().method() === "POST",
  );
  await expect(boardCard.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await boardCard.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  const position = boardCard.locator("tr").filter({ hasText: title });
  await expect(position).toContainText(title);

  const publicResponse = await page.request.get("/api/v1/leadership/board");
  expect(publicResponse.status()).toBe(200);
  const publicRoster = (await publicResponse.json()) as { current: Array<{ title: string }> };
  expect(publicRoster.current.some((entry) => entry.title === title)).toBe(true);

  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${LEADERSHIP_API}/`) && response.request().method() === "DELETE",
  );
  // Whether removal is a button or an item in the row's menu depends on
  // whether this operator may also edit the position, so the helper resolves
  // it rather than this spec assuming one shape.
  await runRowAction(page, position, "Remove position");
  await acceptConfirmDialog(page, "Remove position");
  expect((await deleteResponse).status()).toBe(200);
  await expect(position).toHaveCount(0);

  await page.goto("/portal/#/system/leadership");
  await expect(page).toHaveURL(/\/portal\/#\/system\/leadership$/);
  await expect(page.getByRole("link", { name: "Leadership" })).toBeVisible();

  expect(systemRequests).toEqual(expect.arrayContaining([`GET ${LEADERSHIP_API}`, `POST ${LEADERSHIP_API}`]));
  expect(removedSystemRequests).toEqual([]);
  expect(removedAdminRequests).toEqual([]);
});

/**
 * `Leadership.tsx` mounts two independent `LeadershipPositions` rosters —
 * Board of Directors and Executive Council — but only the Board instance was
 * ever driven through the UI. This exercises the Executive Council body on
 * its own region, plus the "Edit position" path neither roster previously
 * reached (only add and remove were covered).
 *
 * It is also the regression test for the defect that kept it skipped: the
 * Executive Council card sits below the fold, so reaching its picker scrolls
 * the field to the bottom edge of the viewport, and `UserPicker` used to pin
 * its matches to `anchor.bottom + 4` with no flip and no clamp. The popup
 * rendered under the viewport — visible to `toBeVisible()`, outside the
 * viewport for a click, and `position: fixed`, so nothing could scroll it
 * back in. It reads like a two-instance defect only because the second card
 * is the lower one; `assets/ts/ui/popup-placement.ts` now owns the placement
 * for every popup in the portal.
 */
test("permitted staff add and edit an Executive Council position through the System portal", async ({ page }) => {
  const staffEmail = e2eAdminEmail("portal-leadership");
  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/system/leadership");

  const councilCard = page.getByRole("region", { name: "Executive Council" });
  await expect(councilCard).toBeVisible();
  const title = `Browser-test EC Member ${Date.now()}`;
  await councilCard.getByPlaceholder("Search by email or name…").fill(staffEmail);
  // Waited for explicitly, rather than relying on `.click()`'s own actionability
  // retry: the popup is `position: fixed` and repositions itself imperatively
  // once it has real results, so asserting it visible first is the same
  // precaution the UserPicker regression tests elsewhere in this suite take.
  const match = councilCard.getByRole("group", { name: "Matching users" }).getByRole("button", {
    name: new RegExp(staffEmail.replace(/[.]/g, "\\."), "i"),
  });
  await expect(match).toBeVisible({ timeout: 10_000 });
  await match.click();
  await expect(councilCard.getByPlaceholder("Search by email or name…")).toHaveValue(staffEmail);
  await councilCard.getByLabel("Title").fill(title);
  await councilCard.getByLabel("From").fill("2026-08-28");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === LEADERSHIP_API && response.request().method() === "POST",
  );
  // The affiliation lookup that follows picking the user resolves
  // asynchronously — the same reason the Board test above waits for "Add" to
  // become enabled rather than clicking it immediately.
  await expect(councilCard.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await councilCard.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  const position = councilCard.locator("tr").filter({ hasText: title });
  await expect(position).toContainText(title);

  const updatedTitle = `${title} (updated)`;
  await runRowAction(page, position, "Edit position");
  const editForm = page.getByRole("form", { name: /Edit .+'s position/ });
  await expect(editForm).toBeVisible();
  await editForm.getByLabel("Title").fill(updatedTitle);
  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${LEADERSHIP_API}/`) && response.request().method() === "PATCH",
  );
  await editForm.getByRole("button", { name: "Save", exact: true }).click();
  expect((await updateResponse).status()).toBe(200);

  const updatedPosition = councilCard.locator("tr").filter({ hasText: updatedTitle });
  await expect(updatedPosition).toBeVisible();

  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${LEADERSHIP_API}/`) && response.request().method() === "DELETE",
  );
  await runRowAction(page, updatedPosition, "Remove position");
  await acceptConfirmDialog(page, "Remove position");
  expect((await deleteResponse).status()).toBe(200);
  await expect(updatedPosition).toHaveCount(0);
});
