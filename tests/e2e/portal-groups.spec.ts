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
function participationCard(page: Page, groupName: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: groupName, level: 3 }) });
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
    await page.getByRole("menuitemradio", { name: "Active", exact: true }).click();
    await expect(pqcRow).toBeVisible();
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitemradio", { name: "Inactive", exact: true }).click();
    await expect(pqcRow).toHaveCount(0);
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitemradio", { name: "All statuses", exact: true }).click();
    await expect(pqcRow).toBeVisible();

    // The row's own stretched control opens the group's workspace.
    await openRow(pqcRow, "Open Post-Quantum Cryptography Working Group");
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${PQC_GROUP_ID}/overview$`));
    await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();
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

    const card = participationCard(page, "Post-Quantum Cryptography Working Group");
    await expect(card).toBeVisible({ timeout: 10_000 });
    const affiliationCheckbox = card.getByRole("checkbox", { name: orgName });
    await expect(affiliationCheckbox).toBeChecked();
    await card.getByRole("button", { name: "Join selected" }).click();
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });

    // Joined, the card now shows the affiliation under "Participating as" with
    // its own Remove action (behind the row's "Actions for …" menu, like every
    // other row menu in the portal), and the join fieldset/button are gone
    // (nothing left to join).
    await expect(card.getByText("Participating as")).toBeVisible();
    await expect(card.getByRole("button", { name: "Join selected" })).toHaveCount(0);
    const affiliationRow = card.getByRole("listitem").filter({ hasText: orgName });
    await expect(affiliationRow).toBeVisible();
    await runRowAction(page, affiliationRow, "Remove");

    const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
    await expect(
      dialog.getByText(`Stop participating in Post-Quantum Cryptography Working Group on behalf of ${orgName}?`),
    ).toBeVisible();
    await acceptConfirmDialog(page, "Stop participating");
    await expect(
      page.locator(".my-toast", { hasText: "Updated Post-Quantum Cryptography Working Group participation" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Participating as")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Join selected" })).toBeVisible();
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
    const card = participationCard(page, "Post-Quantum Cryptography Working Group");
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Both affiliations are eligible and pre-selected; deselect the second so
    // only the first joins.
    await card.getByRole("checkbox", { name: secondOrg }).uncheck();
    await card.getByRole("button", { name: "Join selected" }).click();
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(firstOrg, { exact: false })).toBeVisible();
    // The remaining eligible affiliation is still offered, now under "Add
    // another affiliation" and with an "Add selected" button.
    await expect(card.getByText("Add another affiliation")).toBeVisible();
    const addButton = card.getByRole("button", { name: "Add selected" });
    await expect(addButton).toBeVisible();
    await card.getByRole("checkbox", { name: secondOrg }).check();
    await addButton.click();
    await expect(
      page.locator(".my-toast", { hasText: "Joined Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });

    // With two affiliations joined, "Leave all" appears alongside the
    // per-affiliation Remove actions.
    const leaveAll = card.getByRole("button", { name: "Leave all" });
    await expect(leaveAll).toBeVisible();
    await leaveAll.click();
    await expect(
      page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByText("Leave Post-Quantum Cryptography Working Group for every affiliation?"),
    ).toBeVisible();
    await acceptConfirmDialog(page, "Leave group");
    await expect(
      page.locator(".my-toast", { hasText: "Left Post-Quantum Cryptography Working Group" }).last(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Participating as")).toHaveCount(0);
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

    const addForm = page.getByRole("region", { name: "Add a person" });
    await expect(addForm).toBeVisible();
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
    // A successful add closes the form and the table reloads with the new row.
    await expect(page.getByRole("region", { name: "Add a person" })).toHaveCount(0);

    await page.getByPlaceholder("Search name, email, organization, or category…").fill(name);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Added by staff");

    const removed = page.waitForResponse(
      (response) =>
        /\/api\/v1\/groups\/[^/]+\/memberships\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    await runRowAction(page, row, "Remove");
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
    await expect(page.getByRole("columnheader", { name: "Source" })).toHaveCount(0);
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
