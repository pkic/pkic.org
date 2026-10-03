/**
 * @covers groups.8.8
 */
import { expect, test } from "@playwright/test";
import { groupDirectoryResponseSchema } from "../../assets/shared/schemas/group-directory";
import { groupDetailResponseSchema, groupMembershipMutationResponseSchema } from "../../assets/shared/schemas/groups";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";

const REMOVED_LEADERSHIP_API = "/api/v1/leadership";

/**
 * Every group shares the Members editor, including governing bodies and working groups.
 * Public rosters remain controlled by the group's publication settings.
 */
for (const group of [
  { slug: "board", name: "Board of Directors", publicRoster: true },
  { slug: "executive-council", name: "Executive Council", publicRoster: true },
  { slug: "pqc", name: "Post-Quantum Cryptography Working Group", publicRoster: false },
]) {
  test(`staff manage the ${group.name} roster from its group workspace`, async ({ page }, testInfo) => {
    const groupApi = `/api/v1/groups/${group.slug}`;
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
    // Settings has no Leadership page; rosters live on their groups. The
    // section's pages are listed in the sidebar now rather than on a strip
    // inside the hub, so that is where the absence is read.
    await page.goto("/portal/#/settings/access-control");
    const sidebar = page.getByRole("complementary", { name: "Portal navigation" });
    await expect(sidebar.getByRole("link", { name: "Access control" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Leadership" })).toHaveCount(0);

    const groupResponse = await page.request.get(groupApi);
    expect(groupResponse.status()).toBe(200);
    const groupId = groupDetailResponseSchema.parse(await groupResponse.json()).group.id;
    /*
     * A fresh document, not a hash change on the Settings page above.
     * Settings canonicalizes its own address in an effect, so a hash-only
     * navigation away from it races that effect for the URL and lands back on
     * Settings about two runs in three. The query string is what makes this a
     * real document navigation; the portal boots at the hash it is given.
     */
    await page.goto(`/portal/?from=roster#/groups/${groupId}/members`);
    const members = page.getByRole("region", { name: "Members" });
    await expect(members).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
    await members.getByRole("button", { name: "Add person" }).first().click();

    // Adding is a page of its own, with its own address: the roster it adds to
    // is not underneath it.
    await expect(page).toHaveURL(new RegExp(`#/groups/${groupId}/members/add$`));
    const addPerson = page.getByRole("region", { name: "Add a person" });
    await expect(members).toHaveCount(0);
    await addPerson.getByPlaceholder("Search by email or name…").fill(director.email);
    await addPerson.getByRole("button", { name: new RegExp(director.email, "i") }).click();
    await expect(addPerson.getByLabel("Seat title")).toHaveCount(0);
    await expect(addPerson.getByRole("link", { name: "Leadership", exact: true })).toHaveAttribute(
      "href",
      `#/groups/${groupId}/leadership`,
    );
    await addPerson.getByLabel("Member since", { exact: false }).fill("2026-08-28");
    await addPerson.getByLabel("Member until").fill("2025-08-28");
    await addPerson.getByRole("button", { name: "Record former seat" }).click();
    await expect(addPerson.getByLabel("Member until")).toHaveAttribute("aria-invalid", "true");
    await addPerson.getByLabel("Member until").fill("");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await addPerson.screenshot({ path: testInfo.outputPath("seat-form-phone.png") });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await addPerson.screenshot({ path: testInfo.outputPath("seat-form-desktop.png") });

    const createResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/api/v1/groups/${groupId}/memberships/`) &&
        response.request().method() === "POST",
    );
    await addPerson.getByRole("button", { name: "Add to group" }).click();
    const created = await createResponse;
    expect(created.status()).toBe(200);
    const added = groupMembershipMutationResponseSchema.parse(await created.json());
    const organizationName = added.memberships.find((entry) => entry.userId === director.userId)?.organizationName;
    expect(organizationName).toBeTruthy();
    // And it returns to the roster it added to.
    await expect(page).toHaveURL(new RegExp(`#/groups/${groupId}/members$`));
    const seat = members.getByRole("row").filter({ hasText: director.email });
    await expect(seat).toContainText("Aug 28, 2026");

    await seat.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit seat" }).click();
    const editor = page.getByRole("region", { name: /^Edit seat for/ });
    const save = editor.getByRole("button", { name: "Save seat", exact: true });
    const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
    await expect(editor).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const saveBox = (await save.boundingBox())!;
      const cancelBox = (await cancel.boundingBox())!;
      expect(Math.abs(saveBox.y - cancelBox.y)).toBeLessThan(2);
      expect(cancelBox.x).toBeGreaterThan(saveBox.x + saveBox.width);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await editor.screenshot({ path: testInfo.outputPath(`edit-seat-actions-${width}.png`) });
    }
    await editor.getByLabel("Member since", { exact: false }).fill("2026-08-01");
    await cancel.click();
    await expect(page).toHaveURL(new RegExp(`#/groups/${groupId}/members$`));
    await seat.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit seat" }).click();
    await expect(editor.getByLabel("Member since", { exact: false })).toHaveValue("2026-08-28");
    await editor.getByLabel("Member since", { exact: false }).fill("2026-08-01");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" && response.url().includes(`/groups/${groupId}/memberships/`),
    );
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`#/groups/${groupId}/members$`));
    await page.reload();
    await seat.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit seat" }).click();
    await expect(editor.getByLabel("Member since", { exact: false })).toHaveValue("2026-08-01");
    await cancel.click();
    await expect(page).toHaveURL(new RegExp(`#/groups/${groupId}/members$`));
    await page.setViewportSize({ width: 1440, height: 1100 });

    const directory = await page.request.get(`${groupApi}/directory`);
    expect(directory.status()).toBe(200);
    const roster = groupDirectoryResponseSchema.parse(await directory.json());
    if (group.publicRoster) {
      expect(roster.roster?.current.find((entry) => entry.person.organizationName === organizationName)?.title).toBe(
        "Member",
      );
    } else {
      expect(roster.roster).toBeNull();
    }

    const endResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/api/v1/groups/${groupId}/memberships/`) &&
        response.request().method() === "DELETE",
    );
    await seat.getByRole("button", { name: new RegExp(`^Actions for`) }).click();
    await page.getByRole("menuitem", { name: "End participation" }).click();
    await acceptConfirmDialog(page, "End participation");
    expect((await endResponse).status()).toBe(200);
    await expect(seat).toHaveCount(0);

    /*
     * Current or former is a property of the seat, so the choice between the two
     * rosters lives in the Seat column's own menu rather than in a pair of
     * buttons above the table. This spec drove the old buttons and hung on one
     * that no longer exists.
     */
    await members.getByRole("button", { name: "Membership dates column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Former members" }).click();
    await expect(members.getByRole("row").filter({ hasText: director.email })).toBeVisible();

    expect(removedRequests).toEqual([]);
    expect((await page.request.get(`${REMOVED_LEADERSHIP_API}/board`)).status()).toBe(404);
  });
}
