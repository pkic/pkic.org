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
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { openRow, runRowAction } from "./helpers/data-table";
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

/**
 * Walks a freshly-submitted membership application through its real stage
 * transitions (pending → in_review → in_consultation → ec_review) and, by
 * default, approves it — the only path that provisions a real organization
 * + user, exactly what member-applications.ts's ALLOWED_STAGE_TRANSITIONS
 * requires. `page` must already be signed in as admin for the stage/approve
 * calls; the initial application submission itself is the public,
 * unauthenticated endpoint.
 *
 * `opts.stopBeforeApprove` leaves the application sitting at `ec_review`
 * instead of calling its own `/approve` API — for tests (e.g. the
 * "Approve & run onboarding" admin-UI click-through) that need to trigger
 * the approval themselves, via the UI, rather than have this helper do it
 * over the API first.
 */
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

  for (const toStage of ["in_review", "in_consultation", "ec_review"]) {
    const status = await page.evaluate(
      async ({ applicationId, toStage }) => {
        const res = await fetch(`/api/v1/members/applications/${applicationId}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage }),
        });
        return res.status;
      },
      { applicationId, toStage },
    );
    expect(status, `stage transition to ${toStage}`).toBe(200);
  }

  if (opts.stopBeforeApprove) {
    return { applicationId, organizationId: null, userId: null };
  }

  const approved = await page.evaluate(async (applicationId) => {
    const res = await fetch(`/api/v1/members/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    const body = (await res.json()) as { organizationId: string | null; userId: string };
    return { status: res.status, body };
  }, applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  return { applicationId, organizationId: approved.body.organizationId, userId: approved.body.userId };
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
    await page.getByRole("button", { name: "← All votes", exact: true }).click();
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

    // The expanded detail is a second table row containing the same title.
    // Anchor the locator to the data row's own named row control — which reads
    // "Show details for …" collapsed and "Hide details for …" expanded — so it
    // stays unique before and after expansion.
    const proposalRow = page
      .getByRole("row")
      .filter({ hasText: title })
      .filter({ has: page.getByRole("button", { name: new RegExp(`^(?:Show|Hide) details for ${title}$`) }) });
    await expect(proposalRow).toBeVisible();
    await openRow(proposalRow, `Show details for ${title}`);
    // The expanded proposal is a region named after the proposal, so it is
    // located the way a reader finds it rather than by a background utility.
    const detail = page.getByRole("region", { name: title });
    await expect(detail.getByText("0 of 1 required endorsements")).toBeVisible();

    const reject = detail.getByRole("button", { name: "Reject proposal" });
    await expect(reject).toBeDisabled();
    await detail.getByRole("button", { name: "Approve and create vote" }).click();
    await acceptConfirmDialog(page, "Approve and create vote");
    await expect(proposalRow).toContainText(/converted to vote/i);

    await tab(page, "All votes").click();
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
    // New sponsorships default to pipeline_stage='new_inquiry' (migration
    // 0034) — assert via the stage badge specifically, since "Advance to
    // stage" is a <select> whose <option>s (incl. "payment pending") are
    // also present in the DOM but hidden.
    await expect(detail.locator("span.pk-badge", { hasText: "new inquiry" })).toBeVisible();

    // Forms are closed until asked for; the record shows its facts first.
    await detail.getByRole("button", { name: "Edit", exact: true }).click();
    await detail.getByLabel("Notes").fill("E2E verification note");
    await detail.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Saved" })).toBeVisible();

    await detail.getByRole("button", { name: "Advance stage" }).click();
    await detail.getByLabel("Advance to stage").selectOption("contacted");
    await detail.getByRole("button", { name: "Advance", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Stage advanced to contacted" })).toBeVisible();
    await expect(detail.locator("span.pk-badge", { hasText: "contacted" })).toBeVisible();
    await expect(detail.getByText(/new inquiry\s*→\s*contacted/i)).toBeVisible();
    expect(canonicalRequests).toEqual(expect.arrayContaining(["GET /api/v1/sponsors/companies"]));
    expect(canonicalRequests.some((request) => request.startsWith("POST /api/v1/sponsors"))).toBe(true);
    expect(canonicalRequests.some((request) => request.startsWith("PATCH /api/v1/sponsors/"))).toBe(true);
    expect(legacyRequests).toEqual([]);
  });

  test("sponsor tiers: add a tier on the real seeded event and confirm it persists", async ({ page }) => {
    const tierName = `E2E Verify Tier ${Date.now()}`;

    await page.goto(`/portal/#/events/${EVENT_SLUG}/settings/sponsor-tiers`);
    await expect(page.getByText(/attendee-data access in the portal/)).toBeVisible({ timeout: 15_000 });

    // Located by role and accessible name rather than by class. Each tier is
    // a `<fieldset>` named by its `<legend>`, so the row is a group and the
    // two controls inside it are reached by the names a reader hears — which
    // will not break the next time the surface is restyled.
    const tierRows = page.getByRole("group", { name: /^Tier \d+$/ });
    await page.getByRole("button", { name: "+ Add tier" }).click();
    const newRow = tierRows.last();
    await newRow.getByRole("textbox", { name: "Tier name" }).fill(tierName);
    await newRow.getByRole("checkbox", { name: "Attendee data access" }).check();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByText(/attendee-data access in the portal/)).toBeVisible({ timeout: 15_000 });
    // `hasText`/getByText can't see an <input>'s value (it isn't a text
    // node), and Playwright has no getByDisplayValue — find the matching
    // tier-name input by its live .value via evaluateAll, then take the row
    // at the same position to check its checkbox.
    const tierInputs = page.getByRole("textbox", { name: "Tier name" });
    await expect(tierInputs.first()).toBeVisible({ timeout: 15_000 });
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
    await signInToPortal(page, ADMIN_EMAIL);
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
    await page.getByRole("menuitemradio", { name: "New Inquiry" }).click();
    await expect(companyRow).toBeVisible();
    await page.getByRole("button", { name: "Stages column options" }).click();
    await page.getByRole("menuitemradio", { name: "Contacted" }).click();
    await expect(companyRow).toHaveCount(0);
    await page.getByRole("button", { name: "Stages column options" }).click();
    await page.getByRole("menuitemradio", { name: "All stages" }).click();
    await expect(companyRow).toBeVisible();

    // The Sponsorships column filters by sponsor type: this fixture is
    // type "event", so "Event" keeps it and "Consortium" drops it.
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitemradio", { name: "Event", exact: true }).click();
    await expect(companyRow).toBeVisible();
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitemradio", { name: "Consortium" }).click();
    await expect(companyRow).toHaveCount(0);
    await page.getByRole("button", { name: "Sponsorships column options" }).click();
    await page.getByRole("menuitemradio", { name: "All types" }).click();
    await expect(companyRow).toBeVisible();
  });

  test("sponsor tier pricing: view and edit the global Settings tab, distinct from a per-event tier", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await signInToPortal(page, ADMIN_EMAIL);
    await page.goto("/portal/#/sponsors");
    // The Settings tab is in-page tab state (`Tabs`/`useState`), not its own
    // URL — reached by activating the tab, not by navigating to it.
    await page.getByRole("tab", { name: "Settings" }).click();

    const pricing = page.getByRole("region", { name: "Sponsorship tier pricing" });
    await expect(pricing).toBeVisible({ timeout: 15_000 });
    // Each row's amount/currency/active controls sit in one `<td>` apiece,
    // associated with the row's own `<form>` by the HTML `form` attribute
    // rather than by DOM nesting under a shared row element — so "first
    // amount field" and "first Save button" are addressed as two
    // same-position locators instead of scoping one through the other.
    const firstAmountField = pricing.getByRole("spinbutton", { name: /amount in cents$/ }).first();
    const firstSave = pricing.getByRole("button", { name: "Save", exact: true }).first();
    await expect(firstAmountField).toBeVisible();

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
    await expect(pricing.getByRole("spinbutton", { name: /amount in cents$/ }).first()).toHaveValue(updatedAmount);
  });

  test("event team: assign and revoke a role through the canonical event resource", async ({ page }) => {
    const email = `e2e-event-team-${Date.now()}@example.test`;
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

    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add", exact: true }) });
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Role").selectOption("program_committee");
    const assigned = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/events/${EVENT_SLUG}/roles` &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Add", exact: true }).click();
    expect((await assigned).status()).toBe(201);

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
        new URL(response.url()).pathname === `/api/v1/events/${EVENT_SLUG}/registrations` &&
        response.request().method() === "GET",
    );
    await page.goto(`/portal/#/events/${EVENT_SLUG}/registrations`);
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Run waitlist promotions" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
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
    await expect(tab(page, "Responses")).toBeVisible({ timeout: 15_000 });
    await expectCurrentTab(page, "Responses");
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
    await expect(tab(page, "Responses")).toBeVisible({ timeout: 15_000 });
    await expectCurrentTab(page, "Responses");
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
    await page.goto("/portal/#/system/organization-content-reviews");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content Reviews" })).toHaveAttribute("aria-current", "page");
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
    await page.getByRole("menuitemradio", { name: "Approved", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: orgName })).toBeVisible();
    expect(canonicalRequests).toContain("GET /api/v1/organizations/content-reviews");
    expect(
      canonicalRequests.some(
        (request) => request.startsWith("POST /api/v1/organizations/content-reviews/") && request.endsWith("/approve"),
      ),
    ).toBe(true);
    expect(legacyRequests).toEqual([]);

    await page.goto("/portal/#/system/organization-content-reviews");
    await expect(page).toHaveURL(/\/portal\/#\/system\/organization-content-reviews$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
    await page.getByRole("menuitem", { name: "Show account administration" }).click();

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

  // P1-R03: closes the "Approve & run onboarding" click-through gap flagged
  // in Phase 1 remediation ("not completed live in-browser") — the button
  // only renders at stage ec_review and its handler gates on a real
  // `window.confirm`, which this test dismisses programmatically the same
  // way the "mailing lists" and "working groups" tests above dismiss theirs.
  test("applications: Approve & run onboarding click-through runs full onboarding", async ({ page }) => {
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
    await expect(page.getByRole("link", { name: "Membership", exact: true })).toHaveClass(/active/);
    // The shared table sends search/filter/pagination to the backend. The
    // stage filter — the Stage column's own menu — is sufficient here because
    // every earlier fixture has already moved out of ec_review.
    await page.getByRole("button", { name: "Stage column options" }).click();
    await page.getByRole("menuitemradio", { name: "EC review", exact: true }).click();
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // The applicant's name heads the detail view as a real heading, so the
    // header is found by its role rather than by the Bootstrap utility classes
    // that used to be on the wrapper. The stage badge is its sibling.
    const applicantHeading = page.getByRole("heading", { name, level: 2 });
    await expect(applicantHeading).toBeVisible({ timeout: 10_000 });
    const header = page.locator("div").filter({ has: applicantHeading }).last();
    await expect(header.getByText("EC review", { exact: true })).toBeVisible();

    const approveButton = page.getByRole("button", { name: "Approve & run onboarding" });
    await expect(approveButton).toBeVisible();
    await approveButton.click();
    await acceptConfirmDialog(page, "Approve & run onboarding");
    await expect(page.locator(".my-toast", { hasText: "Application approved" })).toBeVisible({ timeout: 15_000 });

    // The click-through's own UI state: the confirmation dialog was accepted,
    // the approve call landed (toast above), and the reloaded detail view now
    // shows the post-approval stage with no further transitions available.
    await expect(header.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve & run onboarding" })).toHaveCount(0);
    await expect(page.getByText("No further transitions from this stage.")).toBeVisible();

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
    expect(canonicalRequests).toContain(`POST /api/v1/members/applications/${applicationId}/approve`);
    expect(legacyRequests).toEqual([]);

    // Independent confirmation 3/3: the onboarding welcome email — one of
    // approveApplication's own outbox side effects — actually landed,
    // proving the background outbox delivery this route kicks off also ran,
    // not just the synchronous D1 writes.
    await waitForEmail(email, "Welcome to the PKI Consortium", { since });
  });
});
