import { completeSyntheticMembershipReview, prepareSyntheticMembershipReview } from "./helpers/member-provisioning";
/**
 * E2E coverage for: a real-browser verification pass on
 * permission-scoped management screens that previously lacked complete
 * API/test-level verification only (per their own phase status notes), and
 * this phase's job is only to confirm they actually work end-to-end in a
 * real browser, not to build anything new.
 *
 * Screens covered include sponsorship, event, and user management views,
 * portal System content review, and canonical group Votes/Proposals management
 * (2026-07-27 follow-up).
 *
 * Fixture data (an approved org member, an approved individual member) goes
 * through the real public and permission-scoped application APIs exactly like
 * votes-and-sponsor.spec.ts and sponsor-workspace.spec.ts already do for their
 * own fixtures — an application is created via the public endpoint, walked
 * through its real stage transitions by the signed-in admin, and approved,
 * which provisions a real organization + user. The member then signs in for
 * real via the portal's magic-link flow to produce the content-review and
 * vote-proposal submissions that the canonical portal workflows moderate.
 *
 * Staff authentication happens exactly once for the whole file (`beforeAll`, saved as
 * `storageState` and reused by every test) rather than per-test: the local
 * env's EMAIL_RATE_LIMITER allows only 3 magic-link requests per 60s per
 * address (wrangler.jsonc), and 8 independent sign-ins for the same
 * admin@pkic.org within that window reliably tripped it.
 *
 * @covers sponsor.2.3
 * @covers sponsor.2.3.a
 * @covers sponsor.2.3.b
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runRowAction } from "./helpers/data-table";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { membershipApplicationDetailSchema } from "../../assets/shared/schemas/membership-application-management";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { verifyMembershipJoinEmail } from "./helpers/member-join";
import { signInToPortal } from "./helpers/portal-auth";
import { expectStaffSessionLanding, signInAsE2eStaff } from "./helpers/staff-auth";
import { expectCurrentTab, tab } from "./helpers/tabs";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";
const EVENT_GROUP_ID = "20000000-0000-4000-8000-000000000003";
const ADMIN_AUTH_FILE = path.join("test-results", "portal-management-verification-auth.json");
const ADMIN_EMAIL = e2eAdminEmail("portal-management-verification");

function sendgridServer(): string {
  return process.env.E2E_SENDGRID_API_BASE ?? readFileSync(SENDGRID_URL_FILE, "utf8").trim();
}

async function outboxLength(): Promise<number> {
  const resp = await fetch(`${sendgridServer()}/outbox`);
  const emails = (await resp.json()) as CapturedEmail[];
  return emails.length;
}

/**
 * `since` (an outbox length captured before triggering the send) restricts
 * matches to entries appended after that point. Without it, a test that
 * signs the same address in more than once (e.g. admin@pkic.org, reused
 * across every test in this file) can match an older, already-consumed
 * magic link that's still the most recent match at the moment this starts
 * polling — the new one hasn't landed yet — and then fail downstream with
 * "Magic link already used".
 */
async function waitForEmail(
  to: string,
  subjectFragment: string,
  opts: { timeoutMs?: number; since?: number } = {},
): Promise<CapturedEmail> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const since = opts.since ?? 0;
  const deadline = Date.now() + timeoutMs;
  let lastEmails: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    const resp = await fetch(`${sendgridServer()}/outbox`);
    lastEmails = (await resp.json()) as CapturedEmail[];
    for (let i = lastEmails.length - 1; i >= since; i--) {
      const e = lastEmails[i];
      if (e.to === to && e.subject.toLowerCase().includes(subjectFragment.toLowerCase())) {
        return e;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `No email to <${to}> with subject containing "${subjectFragment}" within ${timeoutMs}ms. ` +
      `Outbox has ${lastEmails.length} email(s) (since=${since}).`,
  );
}

async function signInAsAdmin(page: Page): Promise<void> {
  await signInAsE2eStaff(page, ADMIN_EMAIL);
}

/** Provision synthetic members through a published staff-review policy and its required evidence. */
async function provisionApprovedMember(
  page: Page,
  opts: { email: string; name: string; orgName?: string; category?: string; stopBeforeApprove?: boolean },
): Promise<{ applicationId: string; organizationId: string | null; userId: string | null }> {
  const category = opts.category ?? "F";
  const join = await verifyMembershipJoinEmail(page, opts.email);
  expect(join.status).toBe("application_ready");
  if (join.status !== "application_ready") throw new Error("Expected a membership application continuation");
  const created = await page.evaluate(
    async ({ email, name, orgName, category, joinToken }) => {
      const res = await fetch("/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: email,
          applicantName: name,
          membershipCategory: category,
          organizationName: orgName,
          joinToken,
          answers: {
            reason: "This E2E member wants to contribute to the PKI community.",
            agrees_bylaws: true,
            agrees_code_of_conduct: true,
            agrees_ipr_policy: true,
            warranted_authority: true,
          },
        }),
      });
      const body = (await res.json()) as { applicationId?: string };
      return { status: res.status, body };
    },
    { email: opts.email, name: opts.name, orgName: opts.orgName, category, joinToken: join.joinToken },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const applicationId = created.body.applicationId!;

  if (opts.stopBeforeApprove) {
    await prepareSyntheticMembershipReview(page.request, applicationId);
    return { applicationId, organizationId: null, userId: null };
  }
  const approved = await completeSyntheticMembershipReview(page.request, applicationId);
  return { applicationId, organizationId: approved.organizationId, userId: approved.userId };
}

test.describe("Portal management browser-verification pass", () => {
  test.beforeAll(async ({ browser }) => {
    if (existsSync(ADMIN_AUTH_FILE)) return;
    // `browser.newContext()` inside a test file inherits this describe's
    // `test.use({ storageState: ADMIN_AUTH_FILE })` below (applied even
    // though this call is manual, not the `context`/`page` fixtures) — so
    // without this override it tries to read the very file this hook is
    // about to create, and 404s on the first run.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await signInAsAdmin(page);
    await context.storageState({ path: ADMIN_AUTH_FILE });
    await context.close();
  });

  test.use({ storageState: ADMIN_AUTH_FILE });

  test("does not retain duplicate admin or sponsor portal shells", async ({ request }) => {
    expect((await request.get("/admin/")).status()).toBe(404);
    expect((await request.get("/sponsor-portal/")).status()).toBe(404);
  });

  test("votes: create a vote via the group portal and manage its visibility/ballots", async ({ page }) => {
    const groupId = "20000000-0000-4000-8000-000000000001";
    const title = `E2E Admin-created Vote ${Date.now()}`;
    const closesAt = new Date(Date.now() + 86_400_000);
    const closesAtLocal = closesAt.toISOString().slice(0, 16);

    await page.goto(`/portal/#/groups/${groupId}/votes`);
    await page.getByRole("button", { name: "Create vote" }).click();

    // Creation is its own view: the votes table is gone, not layered above the
    // form, and "new" is a reserved id in the group's votes route.
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes/new$`));
    await expect(page.locator("tbody tr")).toHaveCount(0);

    // The way back leaves without creating anything, and so does the browser's
    // Back button, because the create page has an address of its own.
    await page
      .getByRole("navigation", { name: "Group navigation" })
      .getByRole("link", { name: "Votes", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes$`));
    await page.getByRole("button", { name: "Create vote" }).click();
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes/new$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes$`));
    await page.getByRole("button", { name: "Create vote" }).click();

    const form = page.locator("form").filter({ hasText: "Create vote" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Closes at").fill(closesAtLocal);
    await form.getByRole("button", { name: "Create vote", exact: true }).click();

    // Success navigates to the created vote's own record page: its name as
    // the record heading, its facets as tabs, and the list left behind.
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes/[0-9a-fA-F-]{36}$`));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const voteTabs = page.getByRole("navigation", { name: `${title} sections` });
    await voteTabs.getByRole("link", { name: "Settings" }).click();
    const detail = page.getByRole("region", { name: "Vote management" });
    await expect(detail).toBeVisible();

    // The editor is a named form ("Vote visibility") around a field labelled
    // "Visibility", so the control is asked for by its exact label rather
    // than by a substring that also matches the form around it.
    const visibilityForm = detail.getByRole("form", { name: "Vote visibility" });
    const visibility = visibilityForm.getByLabel("Visibility", { exact: true });
    await visibility.selectOption("public");
    await visibilityForm.getByRole("button", { name: "Save visibility" }).click();
    await expect(visibility).toHaveValue("public");

    // The ballot audit is its own facet, fetched when its tab is opened.
    await voteTabs.getByRole("link", { name: "Ballots" }).click();
    await expect(page.getByText("No ballots have been submitted.")).toBeVisible();
  });

  test("vote proposals: a real member submission is moderated (reject guard + approve bypass)", async ({ page }) => {
    const groupId = "20000000-0000-4000-8000-000000000001";
    // page.evaluate needs a real document loaded first — storageState
    // restores the staff session cookie, but a brand-new page starts on
    // about:blank, where relative-URL fetches have nothing to resolve
    // against.
    await page.goto("/portal/");
    await expectStaffSessionLanding(page);

    // Member proposal submission requires the owning group's canonical
    // min_endorsers_for_ballot policy to be enabled. Configure the group,
    // not the retired workflow-settings endpoint.
    const settingsStatus = await page.evaluate(async (groupId) => {
      const current = await fetch(`/api/v1/groups/${groupId}`, {
        credentials: "same-origin",
      });
      if (!current.ok) return current.status;
      const currentBody = (await current.json()) as { group: { revision: number } };
      const res = await fetch(`/api/v1/groups/${groupId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ expectedRevision: currentBody.group.revision, minEndorsersForBallot: 1 }),
      });
      return res.status;
    }, groupId);
    expect(settingsStatus).toBe(200);

    const stamp = Date.now();
    const email = `e2e-proposer-${stamp}@e2e-vote-proposal-${stamp}.test`;
    await provisionApprovedMember(page, { email, name: "Proposer E2E", orgName: `E2E Proposer Org ${stamp}` });
    await page.context().clearCookies();
    await signInToPortal(page, email);

    const title = `E2E Member Vote Proposal ${stamp}`;
    const submitted = await page.evaluate(
      async ({ title, groupId }) => {
        const res = await fetch(`/api/v1/groups/${encodeURIComponent(groupId)}/vote-proposals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            title,
            description: "An end-to-end test vote proposal.",
            voteType: "motion",
            ownerGroupId: groupId,
          }),
        });
        return { status: res.status, body: await res.text() };
      },
      { title, groupId },
    );
    expect(submitted.status, submitted.body).toBe(200);

    await page.context().clearCookies();
    await signInToPortal(page, ADMIN_EMAIL);
    await page.goto(`/portal/#/groups/${groupId}/votes`);
    // The vote sections swap a panel already on the page, so they are the
    // WAI-ARIA tab pattern rather than plain buttons — reached through the
    // helper that knows both kinds, and asserted to actually be showing.
    await tab(page, "Proposals").click();
    await expectCurrentTab(page, "Proposals");

    // Proposals open their own record page from the list.
    const proposalRow = page.getByRole("row").filter({ hasText: title });
    await expect(proposalRow).toBeVisible();
    await proposalRow.getByRole("link", { name: `Open ${title}`, exact: true }).click();
    const detail = page.getByRole("region", { name: title });
    await expect(detail.getByText("0 of 1 required endorsements")).toBeVisible();

    const reject = detail.getByRole("button", { name: "Reject proposal" });
    await expect(reject).toBeDisabled();
    await detail.getByRole("button", { name: "Approve and create vote" }).click();
    await acceptConfirmDialog(page, "Approve and create vote");
    await expect(page).toHaveURL(new RegExp(`/portal/#/groups/${groupId}/votes/[0-9a-fA-F-]{36}$`));
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Group navigation" })
      .getByRole("link", { name: "Votes", exact: true })
      .click();
    await expectCurrentTab(page, "All votes");
    await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
  });

  test("sponsorships: create an event sponsorship and advance its pipeline stage", async ({ page }) => {
    const contactName = `E2E Sponsor Contact ${Date.now()}`;
    const canonicalRequests: string[] = [];
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/v1/sponsors")) canonicalRequests.push(`${request.method()} ${pathname}`);
      if (pathname.startsWith("/api/v1/admin/sponsorships")) legacyRequests.push(`${request.method()} ${pathname}`);
    });

    await page.context().clearCookies();
    await signInToPortal(page, ADMIN_EMAIL);
    await page.goto("/portal/#/sponsors");
    await page.getByRole("button", { name: "Create sponsorship" }).click();

    // Now that the form is built from the design system's `Field`, every
    // control is reachable by the name its label gives it, so this no longer
    // depends on the label-then-input sibling structure it used to walk.
    const form = page.getByRole("form", { name: "Create sponsorship" });
    await form.getByLabel("Type").selectOption("event");
    // The event is no longer a raw id input: it is the shared type-ahead
    // picker. Typing part of the seeded event's name queries the server, and
    // the match is chosen under the name a reader knows rather than a UUID.
    const eventPicker = form.getByRole("combobox", { name: "Event" });
    await eventPicker.fill("Post-Quantum");
    await form
      .getByRole("option", { name: /Post-Quantum Cryptography Conference/ })
      .first()
      .click();
    await expect(eventPicker).toHaveValue(/Post-Quantum Cryptography Conference/);
    await form.getByLabel("Contact name").fill(contactName);
    await form.getByLabel("Contact email").fill(`e2e-sponsor-${Date.now()}@example.test`);
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Sponsorship created" })).toBeVisible();

    // The top-level list now groups sponsorships by company (a table, one
    // row per company); this sponsorship has no organization or non-member
    // name, so it groups under its contact name. Drill into that company,
    // then pick its (only) sponsorship from the resulting list.
    await page.locator("tr").filter({ hasText: contactName }).click();
    // The company's sponsorships are a table, and each row is a link to the
    // sponsorship's own page, named after what it opens — located by that
    // name rather than by the list class the markup happens to carry.
    await page
      .getByRole("link", { name: /^Open / })
      .first()
      .click();
    // The detail panel names itself after the sponsor, so it is located by
    // that name rather than by the container class it happens to carry.
    const detail = page.getByRole("region", { name: contactName });
    await expect(detail).toBeVisible();
    // The picked event survived the round trip: the record states it under
    // "Event" rather than showing a dangling or absent event reference.
    await expect(
      detail.getByLabel("Sponsorship record").getByText("Post-Quantum Cryptography Conference", { exact: true }),
    ).toBeVisible();
    // New sponsorships default to pipeline_stage='new_inquiry' (migration
    // 0034) — assert via the stage badge specifically, since "Move to stage"
    // is a <select> whose <option>s (incl. "payment pending") are also
    // present in the DOM but hidden.
    // The stage shows in the header and in the Pipeline card; the card is
    // the one asserted.
    await expect(detail.getByLabel("Pipeline").locator("span.pk-badge", { hasText: "new inquiry" })).toBeVisible();

    /*
     * Forms are closed until asked for; the record shows its facts first.
     *
     * Correcting the tier and the point of contact is issue #30: an inquiry
     * arrives with whatever the sender typed, and until now only the fields
     * the pipeline's own automation needed could be fixed afterwards. The
     * tier is a select over the catalog, not a box to spell a tier into.
     */
    const correctedContact = `Corrected ${contactName}`;
    // Commands live in the record's `…` menu (#116); the notes are the
    // shared Markdown editor, filled through its editing surface.
    await detail.getByRole("button", { name: "Sponsorship actions" }).click();
    await page.getByRole("menuitem", { name: "Edit record…" }).click();
    await detail.getByLabel("Contact name").fill(correctedContact);
    await detail.getByLabel("Contact email").fill("verified-contact@sponsor.test");
    await detail.getByRole("textbox", { name: "Notes", exact: true }).fill("E2E verification note");
    await detail.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Saved" })).toBeVisible();

    // This sponsorship carries no organization and no sponsor name of its
    // own, so its contact is what names it — correcting the contact renames
    // the record, and the page is located again under the corrected name.
    const corrected = page.getByRole("region", { name: correctedContact });
    await expect(corrected.getByText("verified-contact@sponsor.test")).toBeVisible();

    await corrected.getByRole("button", { name: "Sponsorship actions" }).click();
    await page.getByRole("menuitem", { name: "Move stage…" }).click();
    const moveDialog = page.getByRole("dialog", { name: "Move stage" });
    // The vocabulary now has a word for a company that decides against it,
    // which staff previously had to record as a lapse or leave in limbo.
    await expect(moveDialog.getByLabel("Move to stage").locator("option", { hasText: "Not proceeding" })).toHaveCount(
      1,
    );
    await moveDialog.getByLabel("Move to stage").selectOption("contacted");
    await moveDialog.getByRole("button", { name: "Move stage", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Stage moved to contacted" })).toBeVisible();
    await expect(corrected.getByLabel("Pipeline").locator("span.pk-badge", { hasText: "contacted" })).toBeVisible();
    await expect(corrected.getByText(/new inquiry\s*→\s*contacted/i)).toBeVisible();
    expect(canonicalRequests).toEqual(expect.arrayContaining(["GET /api/v1/sponsors/companies"]));
    expect(canonicalRequests.some((request) => request.startsWith("POST /api/v1/sponsors"))).toBe(true);
    expect(canonicalRequests.some((request) => request.startsWith("PATCH /api/v1/sponsors/"))).toBe(true);
    expect(legacyRequests).toEqual([]);
  });

  test("sponsor tiers: add a tier on the real seeded event and confirm it persists", async ({ page }) => {
    const tierName = `E2E Verify Tier ${Date.now()}`;

    await page.goto(`/portal/#/events/${EVENT_SLUG}/settings/sponsor-tiers`);
    await expect(page.getByText("Choose which sponsor tiers can access attendee data for this event.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Tier name" })).toHaveCount(0);
    async function editTiers() {
      await page.getByRole("button", { name: "Sponsor tier actions" }).click();
      await page.getByRole("menuitem", { name: "Edit settings" }).click();
    }
    await editTiers();
    const tierRows = page.getByRole("group", { name: /^Tier \d+$/ });
    const originalCount = await tierRows.count();
    await page.getByRole("button", { name: "+ Add tier" }).click();
    await page.getByRole("button", { name: "Save sponsor tiers", exact: true }).click();
    await expect(tierRows.last().getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await editTiers();
    await expect(tierRows).toHaveCount(originalCount);
    await page.getByRole("button", { name: "+ Add tier" }).click();
    const newRow = tierRows.last();
    const name = newRow.getByRole("textbox", { name: "Tier name" });
    await name.pressSequentially(tierName);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue(tierName);
    await newRow.getByRole("checkbox", { name: "Attendee data access" }).check();
    await page.getByRole("button", { name: "Save sponsor tiers", exact: true }).click();
    await expect(page.getByText("Sponsor tiers updated.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Tier name" })).toHaveCount(0);
    await page.reload();
    const savedTier = page.locator(".pk-datalist").filter({ has: page.getByText(tierName, { exact: true }) });
    await expect(savedTier).toContainText("Attendee data access enabled");
    await editTiers();
    const tierInputs = page.getByRole("textbox", { name: "Tier name" });
    const index = await tierInputs.evaluateAll(
      (els, name) => els.findIndex((el) => (el as HTMLInputElement).value === name),
      tierName,
    );
    expect(index, "saved tier not found after reload").toBeGreaterThanOrEqual(0);
    await expect(tierRows.nth(index).getByRole("checkbox", { name: "Attendee data access" })).toBeChecked();
  });

  test("sponsors: the companies list's Stages and Sponsorships column filters narrow the pipeline", async ({
    page,
  }) => {
    const contactName = `E2E Sponsor Filter Contact ${Date.now()}`;

    await page.context().clearCookies();
    // Its own address: the limiter allows three link requests a minute for
    // one, and this file runs its tests back to back.
    await signInToPortal(page, e2eAdminEmail("portal-sponsor-filters"));
    await page.goto("/portal/#/sponsors");
    await page.getByRole("button", { name: "Create sponsorship" }).click();
    const form = page.getByRole("form", { name: "Create sponsorship" });
    await form.getByLabel("Type").selectOption("event");
    await form.getByLabel("Contact name").fill(contactName);
    await form.getByLabel("Contact email").fill(`e2e-sponsor-filter-${Date.now()}@example.test`);
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Sponsorship created" })).toBeVisible();

    const companyRow = page.locator("tr").filter({ hasText: contactName });
    await expect(companyRow).toBeVisible();

    // A fresh sponsorship starts at pipeline_stage='new_inquiry', so the
    // Stages filter keeps it under "New Inquiry" and drops it under any
    // other stage.
    await page.getByRole("button", { name: "Stages column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "New Inquiry" }).click();
    await expect(companyRow).toBeVisible();
    await page.getByRole("button", { name: "Stages column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Contacted" }).click();
    await expect(companyRow).toHaveCount(0);
    await page.getByRole("button", { name: "Stages column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "All stages" }).click();
    await expect(companyRow).toBeVisible();

    // The Sponsorships column filters by sponsor type: this fixture is
    // type "event", so "Event" keeps it and "Consortium" drops it.
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Event", exact: true }).click();
    await expect(companyRow).toBeVisible();
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Consortium" }).click();
    await expect(companyRow).toHaveCount(0);
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "All types" }).click();
    await expect(companyRow).toBeVisible();
  });

  test("sponsor tier pricing: view and edit the global Settings tab, distinct from a per-event tier", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await signInToPortal(page, e2eAdminEmail("portal-sponsor-tier-pricing"));
    await page.goto("/portal/#/sponsors");
    // The Settings tab is in-page tab state (`Tabs`/`useState`), not its own
    // URL — reached by activating the tab, not by navigating to it.
    await page.getByRole("tab", { name: "Settings" }).click();

    const pricing = page.getByRole("region", { name: "Sponsorship tier pricing" });
    await expect(pricing).toBeVisible({ timeout: 15_000 });
    await expect(pricing.getByRole("spinbutton")).toHaveCount(0);
    const editFirst = async () => {
      await pricing
        .getByRole("button", { name: /pricing actions$/ })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Edit pricing" }).click();
    };
    await editFirst();
    const firstAmountField = pricing.getByRole("spinbutton", { name: /amount in cents$/ }).first();
    const firstSave = pricing.getByRole("button", { name: "Save", exact: true }).first();
    await expect(firstAmountField).toBeVisible();

    const originalAmount = await firstAmountField.inputValue();
    await firstAmountField.fill("-1");
    await firstSave.click();
    await expect(firstAmountField).toHaveAttribute("aria-invalid", "true");
    await pricing.getByRole("button", { name: "Cancel", exact: true }).click();
    await editFirst();
    await expect(firstAmountField).toHaveValue(originalAmount);
    const updatedAmount = "123456";
    await firstAmountField.fill(updatedAmount);

    const saveResponse = page.waitForResponse(
      (response) =>
        /\/api\/v1\/sponsors\/tiers\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "PATCH",
    );
    await firstSave.click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.locator(".my-toast", { hasText: "saved" })).toBeVisible();

    // The active tab is in-memory state, not part of the URL, so a reload
    // lands back on Management — re-activate Settings before re-reading it.
    await page.reload();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(pricing).toBeVisible({ timeout: 15_000 });
    await expect(pricing.getByRole("spinbutton")).toHaveCount(0);
    await editFirst();
    await expect(pricing.getByRole("spinbutton", { name: /amount in cents$/ }).first()).toHaveValue(updatedAmount);
  });

  test("event team: assign and revoke a role through the canonical event resource", async ({ page }) => {
    // A team member is an existing user, found with the picker (#88): the
    // journey links the signed-in administrator to the event's team.
    const email = e2eAdminEmail();
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes(`/api/v1/admin/events/${EVENT_SLUG}/permissions`)) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto(`/portal/#/events/${EVENT_SLUG}/settings/team`);
    await expect(page.getByRole("button", { name: "Add team member" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Add team member" }).click();
    // Adding is a page of its own: the list it adds to is not underneath it.
    await expect(page).toHaveURL(new RegExp(`#/groups/${EVENT_GROUP_ID}/events/[^/]+/team/new$`));
    await expect(page.getByRole("table", { name: "Event team members" })).toHaveCount(0);

    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "Add team member", exact: true }),
    });
    await form.getByLabel("Person").fill(email);
    await page.getByRole("group", { name: "Matching users" }).getByRole("button", { name: email }).click();
    await form.getByLabel("Role").selectOption("program_committee");
    const assigned = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/events/${EVENT_SLUG}/roles` &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Add team member", exact: true }).click();
    expect((await assigned).status()).toBe(201);
    // And it returns to the list it added to.
    await expect(page).toHaveURL(new RegExp(`#/groups/${EVENT_GROUP_ID}/events/[^/]+/team$`));

    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("Program Committee");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText("Program Committee");

    const reloadedRow = page.getByRole("row").filter({ hasText: email });
    const revoked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/api/v1/events/${EVENT_SLUG}/roles/`) &&
        response.request().method() === "DELETE",
    );
    await runRowAction(page, reloadedRow, "Revoke");
    await acceptConfirmDialog(page, "Revoke role");
    expect((await revoked).status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    expect(legacyRequests).toEqual([]);
  });

  test("event promoters: load the permission-scoped event resource without an admin API request", async ({ page }) => {
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === `/api/v1/admin/events/${EVENT_SLUG}/promoters`) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });

    const loaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/events/${EVENT_SLUG}/promoters` &&
        response.request().method() === "GET",
    );
    await page.goto(`/portal/#/events/${EVENT_SLUG}/promoters`);
    expect((await loaded).status()).toBe(200);
    await expect(page.getByText(/Active promoters|No promoter activity yet/).first()).toBeVisible({ timeout: 15_000 });
    expect(legacyRequests).toEqual([]);
  });

  test("event analytics: load the permission-scoped event resource without an admin API request", async ({ page }) => {
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === `/api/v1/admin/events/${EVENT_SLUG}/stats`) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });

    const loaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/events/${EVENT_SLUG}/analytics` &&
        response.request().method() === "GET",
    );
    await page.goto(`/portal/#/events/${EVENT_SLUG}/stats`);
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Event dashboard" })).toBeVisible({ timeout: 15_000 });
    expect(legacyRequests).toEqual([]);
  });

  test("event registrations: load the canonical management resource without an admin API request", async ({ page }) => {
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith(`/api/v1/admin/events/${EVENT_SLUG}/registrations`)) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
      if (pathname.startsWith(`/api/v1/admin/events/${EVENT_SLUG}/waitlist`)) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });

    const loaded = page.waitForResponse(
      (response) =>
        new RegExp(`^/api/v1/groups/${EVENT_GROUP_ID}/events/[^/]+/registrations$`).test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "GET",
    );
    await page.goto(`/portal/#/events/${EVENT_SLUG}/registrations`);
    expect((await loaded).status()).toBe(200);
    await page.getByRole("button", { name: "Registration actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Run waitlist promotions" })).toBeVisible();
    await page.keyboard.press("Escape");
    const download = page.getByRole("link", { name: "Download CSV", exact: true });
    await expect(download).toBeVisible();
    await expect(download.locator("svg")).toBeVisible();
    const actions = page.getByRole("button", { name: "Registration actions", exact: true });
    expect(
      Math.abs((await download.boundingBox())!.height - (await actions.boundingBox())!.height),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath("registration-toolbar.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await download.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      await page.getByRole("searchbox").evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await page.screenshot({ path: test.info().outputPath("registration-toolbar-dark.png"), animations: "disabled" });
    await page.goto(`/portal/#/events/${EVENT_SLUG}`);
    const schedule = page.getByLabel("Schedule", { exact: true });
    await expect(schedule).toBeVisible();
    expect(await schedule.evaluate((el) => el.closest("aside") !== null)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("event-overview-dark.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(schedule).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    expect(legacyRequests).toEqual([]);
  });

  // Regression: `/events/:slug/proposals/:proposalId` used to sit ahead of
  // `/events/:slug/:tab/:subTab` in the route Switch, so this sub-tab URL
  // was captured as a proposal id and rendered "Proposal not found" instead
  // of the Responses sub-tab. Detail URLs now live under a reserved
  // `detail` segment (`/events/:slug/proposals/detail/:proposalId`).
  test("event proposals: /proposals/responses renders the Responses sub-tab, not a proposal detail", async ({
    page,
  }) => {
    const proposalDetailRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/v1/proposals/responses") proposalDetailRequests.push(`${request.method()} ${pathname}`);
    });

    await page.goto(`/portal/#/events/${EVENT_SLUG}/proposals/responses`);
    await expect(tab(page, /^Responses$/)).toBeVisible({ timeout: 15_000 });
    await expectCurrentTab(page, /^Responses$/);
    await expect(page.getByText("Proposal not found")).toHaveCount(0);
    expect(proposalDetailRequests).toEqual([]);
  });

  // Same route-precedence regression for registrations: `/events/:slug/registrations/:registrationId`
  // used to capture every Registrations sub-tab (responses, email, the
  // attendance-change presets) as a registration id.
  test("event registrations: /registrations/responses renders the Responses sub-tab, not a registration detail", async ({
    page,
  }) => {
    await page.goto(`/portal/#/events/${EVENT_SLUG}/registrations/responses`);
    await expect(tab(page, /^Responses$/)).toBeVisible({ timeout: 15_000 });
    await expectCurrentTab(page, /^Responses$/);
    await expect(page.getByText("Registration not found")).toHaveCount(0);
  });

  test("organization content review: a real member edit is diffed and approved in the portal", async ({ page }) => {
    const canonicalRequests: string[] = [];
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/v1/organizations/content-reviews")) {
        canonicalRequests.push(`${request.method()} ${pathname}`);
      }
      if (pathname.startsWith("/api/v1/admin/organizations/content-reviews")) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await page.goto("/portal/");
    await expectStaffSessionLanding(page);
    const staffCookies = await page.context().cookies();

    const stamp = Date.now();
    const email = `e2e-content-review-${stamp}@e2e-content-review-${stamp}.test`;
    const orgName = `E2E Content Review Org ${stamp}`;
    const provisioned = await provisionApprovedMember(page, { email, name: "Content Reviewer E2E", orgName });
    expect(provisioned.organizationId).not.toBeNull();
    await page.context().clearCookies();
    await signInToPortal(page, email);

    const newSlogan = `E2E updated slogan ${stamp}`;
    const editStatus = await page.evaluate(
      async ({ slogan, organizationId }) => {
        const res = await fetch(`/api/v1/organizations/${organizationId}/content/reviews`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ slogan }),
        });
        return res.status;
      },
      { slogan: newSlogan, organizationId: provisioned.organizationId! },
    );
    expect(editStatus).toBe(200);

    await page.context().clearCookies();
    await page.context().addCookies(staffCookies);
    await page.reload();
    await expectStaffSessionLanding(page);
    await page.goto("/portal/#/settings/organization-content-reviews");
    await expect(page.getByRole("heading", { name: "Content reviews" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content reviews" })).toHaveAttribute("aria-current", "page");
    // The queue's rows carry a stretched row action, so the row itself is the
    // target and the open submission is a named region rather than a `.card`.
    await page.getByRole("row").filter({ hasText: orgName }).click();

    const detail = page.getByRole("region", { name: orgName });
    await expect(detail.getByText("Slogan", { exact: true })).toBeVisible();
    await expect(detail.getByText(newSlogan)).toBeVisible();

    // Rejecting without a note is refused by the shared reject contract at
    // the field, in the contract's own words, without spending this org's
    // one pending review and without a request.
    await detail.getByRole("button", { name: "Reject" }).click();
    const reviewerNote = detail.getByLabel("Reviewer note");
    await expect(reviewerNote).toHaveAttribute("aria-invalid", "true");
    await expect(detail.getByRole("alert").filter({ hasText: "Write the reason for the rejection" })).toBeVisible();

    await detail.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator(".my-toast", { hasText: "Approved and applied" })).toBeVisible();

    // The status filter is the Status column's own menu; the approved
    // submission is found by narrowing the column to it.
    await page.getByRole("button", { name: "Status column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Approved", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: orgName })).toBeVisible();
    expect(canonicalRequests).toContain("GET /api/v1/organizations/content-reviews");
    expect(
      canonicalRequests.some(
        (request) => request.startsWith("POST /api/v1/organizations/content-reviews/") && request.endsWith("/approve"),
      ),
    ).toBe(true);
    expect(legacyRequests).toEqual([]);

    await page.goto("/portal/#/settings/organization-content-reviews");
    await expect(page).toHaveURL(/\/portal\/#\/settings\/organization-content-reviews$/);
    await expect(page.getByRole("heading", { name: "Content reviews" })).toBeVisible();
    expect(legacyRequests).toEqual([]);
  });

  test("users: secondary email panel", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/portal/");
    await expectStaffSessionLanding(page);

    const stamp = Date.now();
    const primaryEmail = `e2e-primary-${stamp}@e2e-users-${stamp}.test`;
    const extraEmail = `e2e-secondary-${stamp}@e2e-users-${stamp}.test`;

    await provisionApprovedMember(page, {
      email: primaryEmail,
      name: `Primary User ${stamp}`,
      orgName: `E2E Users Org ${stamp}`,
    });

    await page.goto("/portal/#/users");
    await page.getByPlaceholder("email or name").fill(primaryEmail);
    await page.getByPlaceholder("email or name").press("Enter");
    const primaryRow = page.locator("tr").filter({ hasText: primaryEmail });
    await expect(primaryRow).toBeVisible({ timeout: 10_000 });
    await primaryRow.click();
    // The record's name appears as the PageHeader title and again as the
    // breadcrumb's current-page crumb (the trail ends at the record), so the
    // assertion names the heading it means.
    await expect(page.getByRole("heading", { name: `Primary User ${stamp}` })).toBeVisible({ timeout: 10_000 });

    // The addresses an account answers to are administration, not something
    // the record says about the person, so they are disclosed under it.
    await page.getByRole("button", { name: "Account administration", exact: true }).click();

    // Located by role and accessible name rather than by `.card`/`.card-header`:
    // the panel is a named region now, and a role does not break the next time
    // the markup around it is restyled.
    const emailPanel = page.getByRole("region", { name: "Email addresses" });
    await emailPanel.getByLabel("Add a secondary email").fill(extraEmail);
    await emailPanel.getByRole("button", { name: "Add email" }).click();
    await expect(page.locator(".my-toast", { hasText: "Email added" })).toBeVisible();
    await expect(emailPanel.getByText(extraEmail)).toBeVisible();

    await expect(page.getByText("Merge another account into this one")).toHaveCount(0);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("applications: completing the required review runs full onboarding", async ({ page }) => {
    const canonicalRequests: string[] = [];
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/v1/members/applications")) {
        canonicalRequests.push(`${request.method()} ${pathname}`);
      }
      if (pathname.startsWith("/api/v1/admin/applications")) {
        legacyRequests.push(`${request.method()} ${pathname}`);
      }
    });
    page.on("dialog", (d) => d.accept());
    await page.goto("/portal/");
    await expectStaffSessionLanding(page);
    const staffCookies = await page.context().cookies();

    const stamp = Date.now();
    const email = `e2e-approve-onboarding-${stamp}@e2e-approve-onboarding-${stamp}.test`;
    const name = `Approve Onboarding E2E ${stamp}`;
    const orgName = `E2E Approve Onboarding Org ${stamp}`;
    const { applicationId } = await provisionApprovedMember(page, {
      email,
      name,
      orgName,
      stopBeforeApprove: true,
    });

    const since = await outboxLength();
    await page.context().clearCookies();
    await page.context().addCookies(staffCookies);
    await page.reload();
    await expectStaffSessionLanding(page);

    await page.goto("/portal/#/membership/applications");
    await expect(page.getByRole("heading", { name: "Membership" })).toBeVisible();
    // The sidebar entry is named for what it holds: "Membership" beside
    // "Members" said nothing about which of the two a reader wanted.
    await expect(page.getByRole("link", { name: "Applications", exact: true })).toHaveClass(/active/);
    // The shared table sends search/filter/pagination to the backend. The
    // stage filter — the Stage column's own menu — is sufficient here because
    // the search locates this synthetic application.
    await page.getByRole("button", { name: "Stage column options" }).click();
    await page.getByRole("menuitem", { name: "Filter", exact: false }).click();
    await page.getByRole("menuitemradio", { name: "Processing", exact: true }).click();
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // The applicant's name heads the detail view as a real heading, so the
    // header is found by its role rather than by the Bootstrap utility classes
    // that used to be on the wrapper. The stage badge is its sibling.
    const applicantHeading = page.getByRole("heading", { name, level: 2 });
    await expect(applicantHeading).toBeVisible({ timeout: 10_000 });
    const header = page.locator("div").filter({ has: applicantHeading }).last();
    await expect(header.getByText("Processing", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Review workflow and objections", exact: true }).click();
    await page.getByLabel("Review decision and reason").fill("Verified the organization and applicant authority.");
    await page.getByRole("button", { name: "Complete review", exact: true }).click();
    await expect(header.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete review", exact: true })).toHaveCount(0);

    // Independent confirmation 1/3: re-fetch the application from the System
    // API (not the same optimistic UI state the toast/badge above already
    // reflect) — durably approved with an event recording the transition.
    const refetched = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/members/applications/${id}`, { credentials: "same-origin" });
      const body = await res.json();
      return { status: res.status, body };
    }, applicationId);
    expect(refetched.status).toBe(200);
    const refetchedBody = membershipApplicationDetailSchema.parse(refetched.body);
    expect(refetchedBody.stage).toBe("approved");
    expect(refetchedBody.events.some((e) => e.toStage === "approved")).toBe(true);

    // Independent confirmation 2/3: onboarding provisioning
    // (approveApplication -> provisionOrganizationMembership) really ran —
    // a real user now exists, linked to a real organization matching the
    // application's organizationName, not just the application row's own
    // status flag.
    const usersLookup = await page.evaluate(async (q) => {
      const res = await fetch(`/api/v1/users?q=${encodeURIComponent(q)}`, { credentials: "same-origin" });
      const body = (await res.json()) as {
        users: Array<{ id: string; email: string; type: string }>;
      };
      return { status: res.status, body };
    }, email);
    expect(usersLookup.status).toBe(200);
    const provisionedUser = usersLookup.body.users.find((u) => u.email === email);
    expect(provisionedUser, JSON.stringify(usersLookup.body)).toBeTruthy();
    expect(provisionedUser?.type).toBe("member");

    const detailLookup = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/users/${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const body = (await res.json()) as {
        user: { identities: Array<{ organizationName: string | null }> };
      };
      return { status: res.status, body };
    }, provisionedUser!.id);
    expect(detailLookup.status).toBe(200);
    expect(
      detailLookup.body.user.identities.some((identity) => identity.organizationName === orgName),
      JSON.stringify(detailLookup.body),
    ).toBe(true);

    expect(canonicalRequests).toContain(`GET /api/v1/members/applications`);
    expect(canonicalRequests).toContain(`GET /api/v1/members/applications/${applicationId}`);
    expect(canonicalRequests).toContain(`POST /api/v1/members/applications/${applicationId}/reviews/completion`);
    expect(legacyRequests).toEqual([]);

    // Independent confirmation 3/3: the onboarding welcome email — one of
    // approveApplication's own outbox side effects — actually landed,
    // proving the background outbox delivery this route kicks off also ran,
    // not just the synchronous D1 writes.
    await waitForEmail(email, "Welcome to the PKI Consortium", { since });
  });
});
