import { runRowAction } from "./helpers/data-table";
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { definitionFor } from "./helpers/definition-list";

/**
 * Enters the organization record's edit mode.
 *
 * Editing is a command on the record, so it lives in the header's `⋯` menu
 * rather than as a button beside the name — the same place the contact record
 * keeps its own.
 */
async function openOrganizationEditMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Record actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit organization…" }).click();
}

/** Runs one of the Representatives list's add commands from its own menu. */
async function runRepresentativeCommand(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Representative settings", exact: true }).click();
  await page.getByRole("menuitem", { name: label }).click();
}

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

  // Creation is its own view: the directory table is gone, not layered above
  // the form, and "new" is a reserved id in the /organizations/:id route.
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/new$/);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add organization", exact: true })).toHaveCount(0);

  // The way back leaves the page without creating anything, and the browser's
  // Back button does the same, because creation has an address of its own.
  await page.getByRole("button", { name: "← All organizations", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await page.getByRole("button", { name: "Add organization", exact: true }).first().click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/new$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/portal\/#\/organizations$/);
  await page.getByRole("button", { name: "Add organization", exact: true }).first().click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/new$/);

  // Located by the names the form announces — the region, its grouped
  // fieldsets, and each control's label — rather than by generated ids.
  const createForm = page.getByRole("region", { name: "Add organization" });
  const organizationGroup = createForm.getByRole("group", { name: "Details", exact: true });
  await organizationGroup.getByLabel("Organization name").fill(organizationName);
  await organizationGroup.getByLabel("Membership category").selectOption("F");
  await organizationGroup.getByLabel("Member since").fill("2026-01-15");
  await createForm.getByRole("group", { name: "Web presence" }).getByLabel("Website").fill("https://example.invalid");
  // People are optional and the form starts with none; the activation reason
  // only exists once a person has been added, because only that path skips
  // the invitation flow.
  await expect(createForm.getByLabel("Reason for activating without an invitation")).toHaveCount(0);
  await createForm.getByRole("button", { name: "Add person", exact: true }).click();
  const firstPerson = createForm.getByRole("group", { name: "Person 1" });
  await firstPerson.getByLabel("Name").fill("Primary Representative");
  await firstPerson.getByLabel("Email").fill(primaryEmail);
  await firstPerson.getByLabel("Job title").fill("Security Engineer");
  await createForm.getByLabel("Reason for activating without an invitation").fill("E2E organization setup");

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create organization" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByText("Organization created", { exact: true })).toBeVisible();

  // Success navigates straight to the created organization's own detail view,
  // which opens with one statement of the record and its facets as tabs.
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/[0-9a-fA-F-]{36}$/);
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
  // An account page, not a page split into tabs: the record's own facts and
  // its representatives sit directly on the page. (The page does carry one
  // tablist of its own now — the Activity section's groups/events/proposals
  // history — which is a facet's internal navigation, not the page's.)
  await expect(page.getByRole("region", { name: "Representatives" })).toBeVisible();
  await expect(page.getByText(primaryEmail, { exact: true })).toBeVisible();

  await runRepresentativeCommand(page, "Add a new person…");
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

  // The account page answers "is this organization a sponsor" from the
  // canonical staff pipeline list, bounded to this organization, as one of
  // its own bounded queries — an honest "not a sponsor" here, since this
  // organization has none. The request is observed on a reload, since the
  // page already made it.
  const sponsorshipsResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/sponsors" && response.request().method() === "GET",
  );
  await page.reload();
  const sponsorshipsUrl = new URL((await sponsorshipsResponse).url());
  expect(sponsorshipsUrl.searchParams.get("visibility")).toBe("all");
  expect(sponsorshipsUrl.searchParams.get("organizationId")).toBeTruthy();
  await expect(page.getByRole("region", { name: "Sponsorship" }).getByText("Not a sponsor.")).toBeVisible();

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
  await signInToPortal(page, e2eAdminEmail("portal-organizations-users-view"));
  await page.goto("/portal/#/users");
  const userSearch = page.getByPlaceholder("email or name");
  await userSearch.fill(secondaryEmail);
  await userSearch.press("Enter");
  const secondaryUserRow = page.locator("tr").filter({ hasText: secondaryEmail });
  // The list names who the person represents — the organization itself —
  // rather than counting their identities.
  await expect(secondaryUserRow).toContainText(organizationName);
  await secondaryUserRow.click();
  // Located by role rather than by the class the record used to carry: the
  // user's name is a real heading now.
  await expect(page.getByRole("heading", { name: "Secondary Representative", level: 2 })).toBeVisible();
  // The affiliation is stated once, as a tie: the organization's name leads to
  // its own record, and the terms of the tie — the role, when it began, the
  // address it runs through — read as one line under it. It used to be stated
  // twice, here as a description list and again as a management card below.
  // By role, not by class: an affiliation is an `<article>`, and a class
  // selector breaks silently the moment the component restyles.
  const affiliation = page.getByRole("article").filter({ hasText: organizationName });
  await expect(affiliation.getByRole("link", { name: organizationName })).toBeVisible();
  await expect(affiliation).toContainText(secondaryEmail);
  await expect(affiliation).toContainText("Program Manager");

  // Editing the account is administration, not part of what the record says
  // about the person, so it is disclosed rather than stacked under the record.
  await page.getByRole("button", { name: "Account administration", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show account administration" }).click();
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
  await runRowAction(page, representativeRow, "End identity");
  await acceptConfirmDialog(page, "End identity");
  expect((await removeResponse).status()).toBe(200);

  representativeRow = page.getByRole("row").filter({ hasText: secondaryEmail });
  await expect(representativeRow).toContainText("Ended");
  // An ended identity offers nothing to do — neither an inline action nor a menu.
  await expect(representativeRow.getByRole("button", { name: "End identity" })).toHaveCount(0);
  await expect(representativeRow.getByRole("button", { name: /^Actions for / })).toHaveCount(0);

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

/**
 * Regression coverage for the "Link existing user" path: it goes through
 * `UserPicker`, a shared search-and-select component whose Zod response
 * schema once disagreed with what `/api/v1/users` actually returns — every
 * search failed with "Could not search users." until the schema was
 * loosened to match. Nothing exercised that autocomplete through a real
 * browser, so the break shipped unnoticed. This types into the same search
 * box, waits for a real result to render, and picks it — the exact sequence
 * that broke.
 */
test("permitted staff link an existing user as a representative through the UserPicker search", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationName = `E2E Link Existing User Org ${suffix}`;
  const staffEmail = e2eAdminEmail("portal-organizations-representatives");

  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/organizations");
  await page.getByRole("button", { name: "Add organization", exact: true }).first().click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/new$/);

  const createForm = page.getByRole("region", { name: "Add organization" });
  const organizationGroup = createForm.getByRole("group", { name: "Details", exact: true });
  await organizationGroup.getByLabel("Organization name").fill(organizationName);
  await organizationGroup.getByLabel("Membership category").selectOption("F");
  await organizationGroup.getByLabel("Member since").fill("2026-01-15");

  const createResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create organization" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();

  // Reached by role/name alone rather than by climbing from a panel header:
  // the Representatives list is compact, with "Link an existing user…" living in
  // the list's own toolbar next to search/Refresh, and its form opening
  // inside the list panel rather than a fixed spot under a heading.
  await runRepresentativeCommand(page, "Link an existing user…");

  const search = page.getByLabel("Search for a user");
  await expect(search).toBeVisible();
  await search.fill(staffEmail);

  // The picker debounces and calls `GET /api/v1/users`, the same endpoint —
  // and response shape — that the production bug's stricter schema refused
  // to parse. Waiting for the real matching-users popup, not just the
  // network response, proves the client actually rendered what came back.
  const matches = page.getByRole("group", { name: "Matching users" });
  const matchButton = matches.getByRole("button", { name: new RegExp(staffEmail.replace(/[.]/g, "\\.")) });
  await expect(matchButton).toBeVisible({ timeout: 10_000 });
  await matchButton.click();
  await expect(search).toHaveValue(staffEmail);

  const linkResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/identities$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Link", exact: true }).click();
  expect((await linkResponse).status()).toBe(201);
  await expect(page.getByText("Identity invitation sent", { exact: true })).toBeVisible();

  // Linking always invites — it never activates on the spot the way creating
  // an organization with a founding person can — so the roster shows the
  // representative as pending, not active.
  const linkedRow = page.getByRole("row").filter({ hasText: staffEmail });
  await expect(linkedRow).toBeVisible();
  await expect(linkedRow).toContainText("Invitation pending");
});

// A single edge-to-edge rect is rejected server-side as "The SVG has no
// visible content" — cropping-to-content finds nothing to crop to. A distinct
// inset shape over a background is what the sanitizer treats as real content,
// matching the fixture svg-logo-upload.spec.ts already proves works.
const PROFILE_LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
    '<rect width="120" height="120" fill="#ffffff"/>' +
    '<rect x="30" y="30" width="60" height="60" fill="#204060"/></svg>',
  "utf-8",
);

/**
 * Creates a bare organization (no founding people) and lands on its detail
 * page — the shared setup for the Profile and Logo tests below, kept out of
 * each so neither test carries more of the create flow than it needs.
 */
async function createBareOrganization(page: import("@playwright/test").Page, organizationName: string) {
  await page.goto("/portal/#/organizations");
  await page.getByRole("button", { name: "Add organization", exact: true }).first().click();
  const createForm = page.getByRole("region", { name: "Add organization" });
  const organizationGroup = createForm.getByRole("group", { name: "Details", exact: true });
  await organizationGroup.getByLabel("Organization name").fill(organizationName);
  await organizationGroup.getByLabel("Membership category").selectOption("F");
  await organizationGroup.getByLabel("Member since").fill("2026-01-15");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { name: organizationName, exact: true })).toBeVisible();
}

/**
 * Editing is page-level: one "Edit organization…" in the record header's menu
 * puts every card
 * into edit mode at once (each keeps its layout, its values becoming inputs
 * named by `aria-label`), and one "Save" sends one PATCH carrying every
 * field. There is no per-card Edit button and no separate editor form —
 * this exercises fields from three different cards in the one edit/save
 * round trip the page actually offers.
 */
test("permitted staff edit the organization through the page-level Edit/Save", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  // The whole detail page is itself a region named after the organization
  // ("Add organization" -> the org's own name), so this deliberately avoids
  // the word "About" or "Identity" in the fixture name — either would match
  // a substring `getByRole("region", { name: ... })` lookup for those cards.
  const organizationName = `E2E Profile Edit Org ${suffix}`;
  const patchRequests: string[] = [];

  await signInToPortal(page, e2eAdminEmail("portal-organizations-profile"));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/api\/v1\/organizations\/[^/]+$/.test(url.pathname) && request.method() === "PATCH") {
      patchRequests.push(url.pathname);
    }
  });
  await createBareOrganization(page, organizationName);

  await openOrganizationEditMode(page);
  await expect(page.getByRole("button", { name: "Record actions", exact: true })).toHaveCount(0);

  // About card.
  await page.getByLabel("Slogan").fill("Security, standardized.");
  // Identity card — under the logo, not with the About prose.
  await page.getByLabel("Website").fill("https://e2e-profile-edit.example.invalid");
  // Membership card. The field is labeled "Category" here — narrower than
  // the create form's "Membership category" label for the same underlying
  // value, scoped so it cannot match anything else named "Category".
  const membershipEdit = page.getByRole("region", { name: "Membership", exact: true });
  await membershipEdit.getByLabel("Category").selectOption("A");
  await membershipEdit.getByLabel("Member since").fill("2025-06-01");

  const saveResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/organizations\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Organization updated", { exact: true })).toBeVisible();

  // Editing closed and every field from every card landed in the one PATCH.
  await expect(page.getByRole("button", { name: "Record actions", exact: true })).toBeVisible();
  expect(patchRequests).toHaveLength(1);

  // The slogan is the record's lede, under the name in the header — About
  // states the description, and stating the slogan there too printed the same
  // line twice on one screen.
  await expect(page.locator(".pk-profile-header__lede")).toHaveText("Security, standardized.");
  // The mark moved into the header with the subject, so what is left beside
  // the record is where to find the organization: each address paired with the
  // term that names it.
  const links = page.getByRole("region", { name: "Links", exact: true });
  await expect(definitionFor(links, "Website")).toHaveText("e2e-profile-edit.example.invalid");
  await expect(links.getByRole("link", { name: "e2e-profile-edit.example.invalid" })).toHaveAttribute(
    "href",
    "https://e2e-profile-edit.example.invalid",
  );
  const membership = page.getByRole("region", { name: "Membership", exact: true });
  await expect(definitionFor(membership, "Category")).toHaveText("A");

  // The formatted "Member since" display is locale-dependent; re-opening
  // edit round-trips it back into the date input, whose value is always the
  // normalized ISO form regardless of display locale.
  await openOrganizationEditMode(page);
  await expect(page.getByLabel("Member since")).toHaveValue("2025-06-01");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("permitted staff remove an organization's logo", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationName = `E2E Logo Remove Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-organizations-logo"));
  await createBareOrganization(page, organizationName);

  // Upload, then remove — the tile only offers Remove once a logo exists.
  // `LogoTile` is the whole affordance — no panel wraps it — so its controls
  // are reached directly rather than through a "Logo" region that no longer
  // exists. There is only one logo tile on the page, so this stays unambiguous.
  const logo = page;
  await logo.getByRole("button", { name: "Upload logo" }).click();
  const uploadResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/logo$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
    { timeout: 20_000 },
  );
  await page.locator('input[type="file"][accept="image/svg+xml"]').setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: PROFILE_LOGO_SVG,
  });
  expect((await uploadResponse).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Logo uploaded" })).toBeVisible({ timeout: 20_000 });
  await expect(logo.getByRole("button", { name: "Remove", exact: true })).toBeVisible();

  const removeResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/organizations\/[^/]+\/logo$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await logo.getByRole("button", { name: "Remove", exact: true }).click();
  await acceptConfirmDialog(page, "Remove");
  expect((await removeResponse).status()).toBe(200);
  await expect(logo.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await expect(logo.getByRole("button", { name: "Upload logo" })).toBeVisible();
});
