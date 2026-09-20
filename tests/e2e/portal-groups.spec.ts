/**
 * The Groups surface (assets/ts/member-flows/portal/sections/Groups.tsx and
 * its GroupWorkspace/GroupMembers family) had zero end-to-end coverage
 * through the actual rendered UI: the staff catalog table, group creation,
 * self-service join/leave via GroupParticipationCard, and the Members tab's
 * manager (add/remove) and participant (read-only roster) views were only
 * ever exercised via raw `fetch` calls or route-mocked contract tests
 * elsewhere. This file drives them through the real UI against the real
 * seeded stack.
 *
 * Staff authentication happens once for the whole file (`beforeAll`, saved as
 * `storageState`), the same way `portal-management-verification.spec.ts`
 * does it: the local env's EMAIL_RATE_LIMITER allows only 3 magic-link
 * requests per 60s per address, and this file's eight tests each needing
 * their own admin bootstrap would otherwise trip it.
 * @covers groups.8.1
 * @covers groups.8.2
 * @covers groups.8.3
 * @covers groups.8.4
 * @covers groups.8.5
 * @covers groups.8.6
 * @covers groups.8.7
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { openRow, runRowAction } from "./helpers/data-table";
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { signInToPortal } from "./helpers/portal-auth";
import { expectStaffSessionLanding, signInAsE2eStaff } from "./helpers/staff-auth";

/** Seeded Post-Quantum Cryptography Working Group, used as a stable non-mutated fixture. */
const PQC_GROUP_ID = "20000000-0000-4000-8000-000000000003";
const ADMIN_AUTH_FILE = path.join("test-results", "portal-groups-auth.json");
const ADMIN_EMAIL = e2eAdminEmail("portal-group-self-service");

/**
 * The participation card has no `aria-label` of its own; it is found through
 * its own level-3 heading (the group's name), the way `helpers/membership.ts`
 * locates the membership-application header.
 */
/**
 * A group's row in the catalog.
 *
 * The catalog is a table (#51): it was a column of cards, each carrying a
 * checkbox per affiliation and its own Join button, which could not be
 * searched, sorted or paged like every other list in the portal.
 */
function catalogRow(page: Page, groupName: string) {
  return page.getByRole("row").filter({ hasText: groupName });
}

test.describe("Groups: catalog, creation, self-service participation, and the Members tab", () => {
  test.beforeAll(async ({ browser }) => {
    if (existsSync(ADMIN_AUTH_FILE)) return;
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await signInAsE2eStaff(page, ADMIN_EMAIL);
    await context.storageState({ path: ADMIN_AUTH_FILE });
    await context.close();
  });

  test.use({ storageState: ADMIN_AUTH_FILE });

  /** Re-establishes the admin session on a fresh page: storageState restores the cookie, but a brand-new page starts on about:blank. */
  async function gotoAsAdmin(page: Page): Promise<void> {
    await page.goto("/portal/");
    await expectStaffSessionLanding(page);
  }

  test("staff search, sort, and filter the groups catalog, then open a group", async ({ page }) => {
    await gotoAsAdmin(page);
    await page.goto("/portal/#/groups");
    await expect(page.getByRole("heading", { name: "Groups" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New group" })).toBeVisible();

    // Search narrows the table to the PQC fixture by name.
    await page.getByPlaceholder("Search groups…").fill("Post-Quantum Cryptography");
    const pqcRow = page.getByRole("row").filter({ hasText: "Post-Quantum Cryptography Working Group" });
    await expect(pqcRow).toBeVisible({ timeout: 10_000 });
    await expect(pqcRow).toContainText("Working Group");

    // The Status column's own filter menu narrows by active/inactive, not a
    // select above the table.
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Active", exact: true }).click();
    await expect(pqcRow).toBeVisible();
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Inactive", exact: true }).click();
    await expect(pqcRow).toHaveCount(0);
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "All statuses", exact: true }).click();
    await expect(pqcRow).toBeVisible();

    // The row's own stretched control opens the group's workspace.
    await openRow(pqcRow, "Open Post-Quantum Cryptography Working Group");
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${PQC_GROUP_ID}/overview$`));
    await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();
  });

  test("group settings explain the enabled setting", async ({ page }) => {
    await gotoAsAdmin(page);
    await page.goto(`/portal/#/groups/${PQC_GROUP_ID}/settings`);
    await page.getByRole("button", { name: "Group settings actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit settings", exact: true }).click();
    const enabled = page.getByRole("checkbox", { name: "Group enabled", exact: true });
    await expect(enabled).toBeChecked();
    await expect(enabled).toHaveAccessibleDescription(
      "Disabling prevents users from joining or accessing the group as participants, stops automatic enrollment, and ends automatically enrolled memberships. The group and its history are kept.",
    );
    await enabled.focus();
    await page.keyboard.press("Space");
    await expect(enabled).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await enabled.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("group-enabled-help-mobile.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Group settings actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit settings", exact: true }).click();
    await expect(enabled).toBeChecked();
  });

  test("an admin creates a group through the create form and lands on its Settings tab", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Created Group ${suffix}`;

    await gotoAsAdmin(page);
    await page.goto("/portal/#/groups");
    await page.getByRole("button", { name: "New group" }).click();
    await expect(page).toHaveURL(/\/portal\/#\/groups\/new$/);
    await expect(page.getByRole("heading", { name: "Create a group" })).toBeVisible();

    const form = page.getByRole("region", { name: "Create a group" });
    const submit = form.getByRole("button", { name: "Create group", exact: true });
    // The submit button stays disabled until a type and a name are both set.
    await expect(submit).toBeDisabled();

    await form.getByLabel("Group type").fill("Working");
    await form.getByRole("option", { name: /Working Groups/ }).click();
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Description").fill("Created end-to-end by a Playwright spec.");
    await expect(submit).toBeEnabled();

    const created = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/groups") && response.request().method() === "POST",
    );
    await submit.click();
    const response = await created;
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { group: { id: string } };

    // Creation lands on the new group's own Settings tab, not back on the list.
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${body.group.id}/settings$`));
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // The Cancel path, exercised from a second visit, returns to the catalog
    // without creating anything.
    await page.goto("/portal/#/groups/new");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/portal\/#\/groups$/);
  });

  test("a non-privileged member hitting the create page is redirected to the catalog", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `plain-member-${suffix}@plain-member-${suffix}.test`;

    await gotoAsAdmin(page);
    await approveMemberThroughReview(page, {
      email,
      name: `Plain Member ${suffix}`,
      organizationName: `Plain Org ${suffix}`,
    });

    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.goto("/portal/#/groups/new");
    await expect(page).toHaveURL(/\/portal\/#\/groups$/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "New group" })).toHaveCount(0);
  });

  test("a member joins a group via the participation card, then removes that capacity with a confirm dialog", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const email = `join-member-${suffix}@join-member-${suffix}.test`;
    const orgName = `Join Card Org ${suffix}`;

    await gotoAsAdmin(page);
    await approveMemberThroughReview(page, { email, name: `Join Card Member ${suffix}`, organizationName: orgName });

    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.goto("/portal/#/groups");

    const row = catalogRow(page, "Post-Quantum Cryptography Working Group");
    await expect(row).toBeVisible({ timeout: 10_000 });

    /*
     * Nothing is asked until the command is taken. The catalog states what
     * each group is; joining is a command on the row, and the affiliation it
     * acts on behalf of is asked for in the confirmation (#51) rather than by
     * a checkbox standing open beside every group in the list.
     */
    await expect(row.getByRole("checkbox")).toHaveCount(0);
    await runRowAction(page, row, "Join group…");

    // One eligible affiliation, so there is nothing to choose: the dialog
    // names it and confirms rather than offering a list of one.
    const joinDialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(joinDialog.getByText(`You will participate on behalf of ${orgName}.`)).toBeVisible();
    await acceptConfirmDialog(page, "Join group");
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });

    // The row now states the affiliation it participates as, and the command
    // that would join again is gone — there is nothing left to join with.
    await expect(row.getByText(orgName, { exact: false })).toBeVisible({ timeout: 10_000 });
    await runRowAction(page, row, `Stop participating as ${orgName}…`);

    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(
      dialog.getByText(`Stop participating in Post-Quantum Cryptography Working Group on behalf of ${orgName}?`),
    ).toBeVisible();
    await acceptConfirmDialog(page, "Stop participating");
    await expect(
      page.locator(".my-toast", { hasText: "Updated Post-Quantum Cryptography Working Group participation" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    // Back to offering the join, with the affiliation no longer stated.
    await expect(row.getByText(orgName, { exact: false })).toHaveCount(0, { timeout: 10_000 });
  });

  test("a member representing two organizations joins selectively and leaves all affiliations at once", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const email = `dual-member-${suffix}@dual-member-${suffix}.test`;
    const firstOrg = `Dual Org A ${suffix}`;
    const secondOrg = `Dual Org B ${suffix}`;

    await gotoAsAdmin(page);
    const approved = await approveMemberThroughReview(page, {
      email,
      name: `Dual Capacity Member ${suffix}`,
      organizationName: firstOrg,
    });
    const secondCreated = await page.evaluate(
      async ({ organizationName, email }) => {
        const response = await fetch("/api/v1/organizations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name: organizationName,
            membershipCategory: "F",
            memberSince: "2026-01-15",
            identities: [{ name: "Dual Capacity Delegate", email, jobTitle: "Delegate" }],
            activationReason: "E2E dual-capacity fixture",
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      { organizationName: secondOrg, email },
    );
    expect(secondCreated.status, JSON.stringify(secondCreated.body)).toBe(201);
    void approved;

    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.goto("/portal/#/groups");
    const row = catalogRow(page, "Post-Quantum Cryptography Working Group");
    await expect(row).toBeVisible({ timeout: 10_000 });

    /*
     * Two eligible affiliations, so the command has a scope to ask about. The
     * dialog offers both, every one selected — the common case is all of them
     * — and the reader clears the ones they do not want. This is the choice
     * that used to be a column of checkboxes on the card (#51).
     */
    await runRowAction(page, row, "Join group…");
    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(dialog.getByRole("group", { name: "Join on behalf of" })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: firstOrg })).toBeChecked();
    await dialog.getByRole("checkbox", { name: secondOrg }).uncheck();
    await acceptConfirmDialog(page, "Join group");
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(firstOrg, { exact: false })).toBeVisible({ timeout: 10_000 });

    // The affiliation that stayed out is still offered, under a command that
    // says what it would do rather than repeating "Join".
    await runRowAction(page, row, "Join on behalf of…");
    await expect(dialog.getByText(`You will participate on behalf of ${secondOrg}.`)).toBeVisible();
    await acceptConfirmDialog(page, "Join group");
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(secondOrg, { exact: false })).toBeVisible({ timeout: 10_000 });

    // With two joined, leaving for all of them at once is offered.
    await runRowAction(page, row, "Leave for every affiliation…");
    await expect(
      dialog.getByText("Leave Post-Quantum Cryptography Working Group for every affiliation?"),
    ).toBeVisible();
    await acceptConfirmDialog(page, "Leave group");
    await expect(
      page.locator(".my-toast", { hasText: "Left Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(firstOrg, { exact: false })).toHaveCount(0, { timeout: 10_000 });
  });

  test("a group manager adds and removes a member through the Members tab", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `roster-member-${suffix}@roster-member-${suffix}.test`;
    const name = `Roster Member ${suffix}`;

    await gotoAsAdmin(page);
    await approveMemberThroughReview(page, { email, name, organizationName: `Roster Org ${suffix}` });

    await page.goto(`/portal/#/groups/${PQC_GROUP_ID}/members`);
    await expect(page.getByRole("region", { name: "Members" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Add person" }).click();

    // Adding is a page of its own: the roster it adds to is not underneath it.
    await expect(page).toHaveURL(new RegExp(`#/groups/${PQC_GROUP_ID}/members/add$`));
    const addForm = page.getByRole("region", { name: "Add a person" });
    await expect(addForm).toBeVisible();
    await expect(page.getByRole("region", { name: "Members" })).toHaveCount(0);
    await addForm.getByLabel("Search for a user").fill(email);
    await expect(page.getByRole("group", { name: "Matching users" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: new RegExp(email) }).click();

    const added = page.waitForResponse(
      (response) =>
        /\/api\/v1\/groups\/[^/]+\/memberships\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "POST",
    );
    await addForm.getByRole("button", { name: "Add to group" }).click();
    expect((await added).status()).toBe(200);
    // A successful add returns to the roster, which reloads with the new row.
    await expect(page).toHaveURL(new RegExp(`#/groups/${PQC_GROUP_ID}/members$`));
    await expect(page.getByRole("region", { name: "Add a person" })).toHaveCount(0);

    await page.getByPlaceholder("Search name, email, organization, or category…").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("columnheader", { name: "Joined through" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Membership dates" })).toBeVisible();
    await page.getByRole("button", { name: "Choose columns" }).click();
    await page.getByRole("menuitemradio", { name: "Joined through", exact: true }).click();
    await expect(row).toContainText("Added by staff");

    const removed = page.waitForResponse(
      (response) =>
        /\/api\/v1\/groups\/[^/]+\/memberships\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    // "End participation", not "Remove": a seat that ends stays as the group's
    // history rather than being deleted, and the action says so. The spec was
    // still reaching for the old name and waited for a menu item that is no
    // longer offered.
    await runRowAction(page, row, "End participation");
    await expect(
      page.getByRole("alertdialog").getByText(`End group participation for ${name}`, { exact: false }),
    ).toBeVisible();
    await acceptConfirmDialog(page, "End participation");
    expect((await removed).status()).toBe(200);
    await expect(page.getByPlaceholder("Search name, email, organization, or category…")).toHaveValue(name);
    await expect(row).toHaveCount(0);
  });

  test("a participant sees the read-only roster with no management affordances", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `participant-${suffix}@participant-${suffix}.test`;
    const orgName = `Participant Org ${suffix}`;

    await gotoAsAdmin(page);
    await approveMemberThroughReview(page, { email, name: `Participant ${suffix}`, organizationName: orgName });

    await page.context().clearCookies();
    await signInToPortal(page, email);
    const joined = await page.evaluate(async (groupId) => {
      const response = await fetch(`/api/v1/groups/${groupId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
      });
      return response.status;
    }, PQC_GROUP_ID);
    expect(joined).toBe(200);

    await page.goto(`/portal/#/groups/${PQC_GROUP_ID}/members`);
    await expect(page.getByRole("table", { name: "Members" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("Search name or organization…")).toBeVisible();
    // The participant projection has no Add-person action, no row menus, and
    // none of the manager-only columns.
    await expect(page.getByRole("button", { name: "Add person" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Actions for /, exact: false })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Category" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Joined through" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Member" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Represents" })).toBeVisible();
  });

  test("workspace navigation: an unreachable tab shows the permission-denied fallback", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `nav-participant-${suffix}@nav-participant-${suffix}.test`;

    await gotoAsAdmin(page);
    await approveMemberThroughReview(page, {
      email,
      name: `Nav Participant ${suffix}`,
      organizationName: `Nav Org ${suffix}`,
    });

    await page.context().clearCookies();
    await signInToPortal(page, email);
    await page.evaluate(async (groupId) => {
      await fetch(`/api/v1/groups/${groupId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
      });
    }, PQC_GROUP_ID);

    // A plain participant has no `manage` capability, so the Settings tab is
    // not offered; navigating straight to its URL hits the workspace's own
    // unreachable-view fallback rather than crashing or rendering the form.
    await page.goto(`/portal/#/groups/${PQC_GROUP_ID}/settings`);
    await expect(page.getByText("This group section is not available to your current identity.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();

    // The slug form of the address canonicalizes to the id, preserving the
    // rest of the path.
    await page.goto("/portal/#/groups/pqc/overview");
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${PQC_GROUP_ID}/overview$`), { timeout: 10_000 });
  });
});
