import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

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

  const boardCard = page.locator(".card").filter({ has: page.getByText("Board of Directors", { exact: true }) });
  const title = `Browser-test Board Member ${Date.now()}`;
  await boardCard.getByPlaceholder("Search by email or name…").fill(staffEmail);
  await boardCard.getByRole("button", { name: new RegExp(staffEmail, "i") }).click();
  await boardCard.getByPlaceholder("Title (e.g. Board Member)").fill(title);
  await boardCard.getByTitle("From").fill("2026-08-28");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === LEADERSHIP_API && response.request().method() === "POST",
  );
  await expect(boardCard.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await boardCard.getByRole("button", { name: "Add", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  const position = boardCard.locator(".portal-leadership-name").locator("..", { hasText: title });
  await expect(position).toContainText(title);

  const publicResponse = await page.request.get("/api/v1/leadership/board");
  expect(publicResponse.status()).toBe(200);
  const publicRoster = (await publicResponse.json()) as { current: Array<{ title: string }> };
  expect(publicRoster.current.some((entry) => entry.title === title)).toBe(true);

  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${LEADERSHIP_API}/`) && response.request().method() === "DELETE",
  );
  await position.getByRole("button", { name: "Row actions" }).click();
  await page.getByRole("menuitem", { name: "Remove position" }).click();
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
