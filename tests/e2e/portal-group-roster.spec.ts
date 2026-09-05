import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";

const BOARD_API = "/api/v1/groups/board";
const REMOVED_LEADERSHIP_API = "/api/v1/leadership";

/**
 * The Board of Directors is an ordinary group: staff manage its dated seats
 * from the group's Members tab, the public roster reads the group directory,
 * and the retired leadership-positions API is gone.
 */
test("staff manage the Board of Directors roster from its group workspace", async ({ page }) => {
  const removedRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === REMOVED_LEADERSHIP_API || pathname.startsWith(`${REMOVED_LEADERSHIP_API}/`)) {
      removedRequests.push(`${request.method()} ${pathname}`);
    }
  });

  const staffEmail = e2eAdminEmail("portal-leadership");
  await signInToPortal(page, staffEmail);
  // A seat needs a person with a live Member capacity; provision one the way
  // the product does, through the application flow.
  const director = await createMember(page);
  // The System area no longer has a Leadership destination; rosters live on their groups.
  await page.goto("/portal/#/system/access-control");
  await expect(page.getByRole("navigation", { name: "System management" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "System management" }).getByRole("link", { name: "Leadership" }),
  ).toHaveCount(0);

  const boardResponse = await page.request.get(BOARD_API);
  expect(boardResponse.status()).toBe(200);
  const boardId = ((await boardResponse.json()) as { group: { id: string } }).group.id;
  await page.goto(`/portal/#/groups/${boardId}/members`);
  await expect(page.getByRole("heading", { name: "Board of Directors" })).toBeVisible();
  const members = page.getByRole("region", { name: "Members" });
  await members.getByRole("button", { name: "Add person" }).first().click();
  await members.getByPlaceholder("Search by email or name…").fill(director.email);
  await members.getByRole("button", { name: new RegExp(director.email, "i") }).click();
  const title = `Browser-test Treasurer ${Date.now()}`;
  // By label, not by a hand-written id: the seat fields moved onto the design
  // system's Field, which generates its own ids, so #managed-group-member-title
  // has matched nothing since — and an id selector fails silently when it goes.
  await members.getByLabel("Seat title").fill(title);
  await members.getByLabel("Member since", { exact: false }).fill("2026-08-28");

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`/api/v1/groups/${boardId}/memberships/`) &&
      response.request().method() === "POST",
  );
  await members.getByRole("button", { name: "Add to group" }).click();
  expect((await createResponse).status()).toBe(200);
  const seat = members.getByRole("row").filter({ hasText: title });
  await expect(seat).toContainText("Aug 28, 2026");

  const directory = await page.request.get(`${BOARD_API}/directory`);
  expect(directory.status()).toBe(200);
  const roster = (await directory.json()) as { roster: { current: Array<{ title: string }> } | null };
  expect(roster.roster?.current.some((entry) => entry.title === title)).toBe(true);

  const endResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`/api/v1/groups/${boardId}/memberships/`) &&
      response.request().method() === "DELETE",
  );
  await seat.getByRole("button", { name: new RegExp(`^Actions for`) }).click();
  await page.getByRole("menuitem", { name: "End participation" }).click();
  await acceptConfirmDialog(page, "End participation");
  expect((await endResponse).status()).toBe(200);
  await expect(seat).toHaveCount(0);

  await members.getByRole("button", { name: "Former", exact: true }).click();
  await expect(members.getByRole("row").filter({ hasText: title })).toBeVisible();

  expect(removedRequests).toEqual([]);
  expect((await page.request.get(`${REMOVED_LEADERSHIP_API}/board`)).status()).toBe(404);
});
