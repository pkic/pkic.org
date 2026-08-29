/**
 * E2E coverage for: a real-browser verification pass on
 * "built but never browser-verified" admin screens — these all shipped with
 * API/test-level verification only (per their own phase status notes), and
 * this phase's job is only to confirm they actually work end-to-end in a
 * real browser, not to build anything new.
 *
 * Screens covered include the remaining sponsorship/event/user admin views,
 * portal System content review, and canonical group Votes/Proposals management
 * (2026-07-27 follow-up).
 *
 * Fixture data (an approved org member, an approved individual member) goes
 * through the real public/admin application APIs exactly like
 * votes-and-sponsor.spec.ts and sponsor-portal.spec.ts already do for their
 * own fixtures — an application is created via the public endpoint, walked
 * through its real stage transitions by the signed-in admin, and approved,
 * which provisions a real organization + user. The member then signs in for
 * real via the portal's magic-link flow to produce the content-review and
 * vote-proposal submissions that the canonical portal workflows moderate.
 *
 * Admin auth happens exactly once for the whole file (`beforeAll`, saved as
 * `storageState` and reused by every test) rather than per-test: the local
 * env's EMAIL_RATE_LIMITER allows only 3 magic-link requests per 60s per
 * address (wrangler.jsonc), and 8 independent sign-ins for the same
 * admin@pkic.org within that window reliably tripped it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { membershipApplicationDetailSchema } from "../../assets/shared/schemas/membership-application-management";
import { verifyMembershipJoinEmail } from "./helpers/member-join";
import { signInToPortal } from "./helpers/portal-auth";
import { expectStaffSessionLanding, signInAsE2eStaff } from "./helpers/staff-auth";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";
const ADMIN_AUTH_FILE = path.join("test-results", "admin-verification-auth.json");
const ADMIN_EMAIL = e2eAdminEmail("admin-verification");

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

test.describe("Admin browser-verification pass", () => {
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

  test("votes: create a vote via the group portal and manage its visibility/ballots", async ({ page }) => {
    const groupId = "20000000-0000-4000-8000-000000000001";
    const title = `E2E Admin-created Vote ${Date.now()}`;
    const closesAt = new Date(Date.now() + 86_400_000);
    const closesAtLocal = closesAt.toISOString().slice(0, 16);

    await page.goto(`/portal/#/groups/${groupId}/votes`);
    await page.getByRole("button", { name: "Create vote" }).click();

    const form = page.locator("form").filter({ hasText: "Create vote" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Closes at").fill(closesAtLocal);
    await form.getByRole("button", { name: "Create vote", exact: true }).click();

    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Details" }).click();
    const detail = page.getByRole("region", { name: "Vote management" });
    await expect(detail).toBeVisible();

    const visibility = detail.getByLabel("Visibility");
    await visibility.selectOption("public");
    await detail.getByRole("button", { name: "Save visibility" }).click();
    await expect(visibility).toHaveValue("public");

    await detail.getByRole("button", { name: "Load identifiable ballots" }).click();
    await expect(detail.getByText("No ballots have been submitted.")).toBeVisible();
  });

  test("vote proposals: a real member submission is moderated (reject guard + approve bypass)", async ({ page }) => {
    const groupId = "20000000-0000-4000-8000-000000000001";
    // page.evaluate needs a real document loaded first — storageState
    // restores the admin session cookie, but a brand-new page starts on
    // about:blank, where relative-URL fetches have nothing to resolve
    // against.
    await page.goto("/admin/");
    await expectStaffSessionLanding(page);

    // Member proposal submission requires the owning group's canonical
    // min_endorsers_for_ballot policy to be enabled. Configure the group,
    // not the retired workflow-settings endpoint.
    const settingsStatus = await page.evaluate(async (groupId) => {
      const current = await fetch(`/api/v1/groups/${groupId}?manageable=true`, {
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
        const res = await fetch("/api/v1/portal/vote-proposals", {
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
    await page.getByRole("button", { name: "Proposals", exact: true }).click();

    // The expanded detail is a second table row containing the same title.
    // Anchor the locator to the data row's Details action so it remains
    // unique before and after expansion.
    const proposalRow = page
      .getByRole("row")
      .filter({ hasText: title })
      .filter({ has: page.getByRole("button", { name: "Details", exact: true }) });
    await expect(proposalRow).toBeVisible();
    await proposalRow.getByRole("button", { name: "Details" }).click();
    const detail = page.locator("div.p-3.bg-body-tertiary").filter({ hasText: title });
    await expect(detail.getByText("0 of 1 required endorsements")).toBeVisible();

    const reject = detail.getByRole("button", { name: "Reject proposal" });
    await expect(reject).toBeDisabled();
    page.once("dialog", (dialog) => dialog.accept());
    await detail.getByRole("button", { name: "Approve and create vote" }).click();
    await expect(proposalRow).toContainText(/converted to vote/i);

    await page.getByRole("button", { name: "Votes", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
  });

  test("sponsorships: create an event sponsorship and advance its pipeline stage", async ({ page }) => {
    const contactName = `E2E Sponsor Contact ${Date.now()}`;
    const canonicalRequests: string[] = [];
    const legacyRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/v1/sponsorships")) canonicalRequests.push(`${request.method()} ${pathname}`);
      if (pathname.startsWith("/api/v1/admin/sponsorships")) legacyRequests.push(`${request.method()} ${pathname}`);
    });

    await page.context().clearCookies();
    await signInToPortal(page, ADMIN_EMAIL);
    await page.goto("/portal/#/system/sponsorships");
    await page.getByRole("button", { name: "Create sponsorship" }).click();

    // Labels aren't `<label for>`-linked to their inputs here either —
    // target by the label-then-input sibling structure (see the Votes
    // test's same note).
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create", exact: true }) });
    await form.locator("select").selectOption("event");
    await form.locator('div:has(> label:text-is("Contact name")) > input').fill(contactName);
    await form
      .locator('div:has(> label:text-is("Contact email")) > input')
      .fill(`e2e-sponsor-${Date.now()}@example.test`);
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Sponsorship created" })).toBeVisible();

    // The top-level list now groups sponsorships by company (a table, one
    // row per company); this sponsorship has no organization or non-member
    // name, so it groups under its contact name. Drill into that company,
    // then pick its (only) sponsorship from the resulting list.
    await page.locator("tr").filter({ hasText: contactName }).click();
    await page.locator(".list-group-item").first().click();
    const detail = page.locator(".card").filter({ has: page.getByRole("heading", { name: contactName }) });
    await expect(detail).toBeVisible();
    // New sponsorships default to pipeline_stage='new_inquiry' (migration
    // 0034) — assert via the stage badge specifically, since "Advance to
    // stage" is a <select> whose <option>s (incl. "payment pending") are
    // also present in the DOM but hidden.
    await expect(detail.locator("span.badge", { hasText: "new inquiry" })).toBeVisible();

    await detail.locator('div:has(> label:text-is("Notes")) > input').fill("E2E verification note");
    await detail.getByRole("button", { name: "Save fields" }).click();
    await expect(page.locator(".my-toast", { hasText: "Saved" })).toBeVisible();

    await detail.locator("select").selectOption("contacted");
    await detail.getByRole("button", { name: "Advance" }).click();
    await expect(page.locator(".my-toast", { hasText: "Stage advanced to contacted" })).toBeVisible();
    await expect(detail.locator("span.badge", { hasText: "contacted" })).toBeVisible();
    await expect(detail.getByText(/new inquiry\s*→\s*contacted/)).toBeVisible();
    expect(canonicalRequests).toEqual(expect.arrayContaining(["GET /api/v1/sponsorships/companies"]));
    expect(canonicalRequests.some((request) => request.startsWith("POST /api/v1/sponsorships"))).toBe(true);
    expect(canonicalRequests.some((request) => request.startsWith("PATCH /api/v1/sponsorships/"))).toBe(true);
    expect(legacyRequests).toEqual([]);
  });

  test("sponsor tiers: add a tier on the real seeded event and confirm it persists", async ({ page }) => {
    const tierName = `E2E Verify Tier ${Date.now()}`;

    await page.goto(`/admin/#/events/${EVENT_SLUG}/settings/sponsor-tiers`);
    await expect(page.getByText(/attendee-data access via the sponsor portal/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "+ Add tier" }).click();
    const newRow = page.locator("div.row.g-2.align-items-center.mb-2").last();
    await newRow.locator("input.form-control-sm").fill(tierName);
    await newRow.locator("input[type=checkbox]").check();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible();

    await page.reload();
    await expect(page.getByText(/attendee-data access via the sponsor portal/)).toBeVisible({ timeout: 15_000 });
    // `hasText`/getByText can't see an <input>'s value (it isn't a text
    // node), and Playwright has no getByDisplayValue — find the matching
    // tier-name input by its live .value via evaluateAll, then walk up to
    // the row to check its sibling checkbox.
    const tierInputs = page.locator("input.form-control-sm");
    await expect(tierInputs.first()).toBeVisible({ timeout: 15_000 });
    const index = await tierInputs.evaluateAll(
      (els, name) => els.findIndex((el) => (el as HTMLInputElement).value === name),
      tierName,
    );
    expect(index, "saved tier not found after reload").toBeGreaterThanOrEqual(0);
    const savedRow = tierInputs
      .nth(index)
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' row ')][1]");
    await expect(savedRow.locator("input[type=checkbox]")).toBeChecked();
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

    await page.goto(`/admin/#/events/${EVENT_SLUG}/settings/team`);
    await expect(page.getByText("Add team member", { exact: true })).toBeVisible({ timeout: 15_000 });

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
    page.once("dialog", (dialog) => dialog.accept());
    await reloadedRow.getByRole("button", { name: "Revoke" }).click();
    expect((await revoked).status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: email })).toHaveCount(0);
    expect(legacyRequests).toEqual([]);
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

    await page.goto("/admin/");
    await expectStaffSessionLanding(page);
    const staffCookies = await page.context().cookies();

    const stamp = Date.now();
    const email = `e2e-content-review-${stamp}@e2e-content-review-${stamp}.test`;
    const orgName = `E2E Content Review Org ${stamp}`;
    await provisionApprovedMember(page, { email, name: "Content Reviewer E2E", orgName });
    await page.context().clearCookies();
    await signInToPortal(page, email);

    const newSlogan = `E2E updated slogan ${stamp}`;
    const editStatus = await page.evaluate(async (slogan) => {
      const res = await fetch("/api/v1/me/organization", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slogan }),
      });
      return res.status;
    }, newSlogan);
    expect(editStatus).toBe(200);

    await page.context().clearCookies();
    await page.context().addCookies(staffCookies);
    await page.reload();
    await expectStaffSessionLanding(page);
    await page.goto("/portal/#/system/organization-content-reviews");
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content Reviews" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: orgName }).click();

    const detail = page.locator(".card").filter({ has: page.getByText(orgName) });
    await expect(detail.getByText("Slogan", { exact: true })).toBeVisible();
    await expect(detail.getByText(newSlogan)).toBeVisible();

    // Rejecting without a note is blocked client-side — confirms the
    // required-note guard without spending this org's one pending review.
    await detail.getByRole("button", { name: "Reject" }).click();
    await expect(page.locator(".my-toast", { hasText: "A reviewer note is required to reject" })).toBeVisible();

    await detail.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator(".my-toast", { hasText: "Approved and applied" })).toBeVisible();

    await page.getByLabel("Review status").selectOption("approved");
    await expect(page.getByRole("button", { name: orgName })).toBeVisible();
    expect(canonicalRequests).toContain("GET /api/v1/organizations/content-reviews");
    expect(
      canonicalRequests.some(
        (request) => request.startsWith("POST /api/v1/organizations/content-reviews/") && request.endsWith("/approve"),
      ),
    ).toBe(true);
    expect(legacyRequests).toEqual([]);

    await page.goto("/admin/#/organizations/content-reviews");
    await expect(page).toHaveURL(/\/portal\/#\/system\/organization-content-reviews$/);
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
    expect(legacyRequests).toEqual([]);
  });

  test("users: secondary email panel", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/admin/");
    await expectStaffSessionLanding(page);

    const stamp = Date.now();
    const primaryEmail = `e2e-primary-${stamp}@e2e-users-${stamp}.test`;
    const extraEmail = `e2e-secondary-${stamp}@e2e-users-${stamp}.test`;

    await provisionApprovedMember(page, {
      email: primaryEmail,
      name: `Primary User ${stamp}`,
      orgName: `E2E Users Org ${stamp}`,
    });

    await page.goto("/admin/#/users");
    await page.getByPlaceholder("email or name").fill(primaryEmail);
    await page.getByPlaceholder("email or name").press("Enter");
    const primaryRow = page.locator("tr").filter({ hasText: primaryEmail });
    await expect(primaryRow).toBeVisible({ timeout: 10_000 });
    await primaryRow.click();
    await expect(page.getByText(`Primary User ${stamp}`)).toBeVisible({ timeout: 10_000 });

    const emailPanel = page
      .locator(".card")
      .filter({ has: page.locator(".card-header", { hasText: "Email addresses" }) });
    await emailPanel.locator("input[type=email]").fill(extraEmail);
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
    await page.goto("/admin/");
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

    await page.goto("/portal/#/system/membership-applications");
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Membership Applications" })).toHaveAttribute("aria-current", "page");
    // The shared table sends search/filter/pagination to the backend. The
    // stage filter is sufficient here because every earlier fixture has
    // already moved out of ec_review.
    const stageFilter = page.locator("select").filter({ has: page.locator('option[value="ec_review"]') });
    await stageFilter.selectOption("ec_review");
    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const header = page.locator("div.d-flex.align-items-center.gap-2.mb-3").filter({ hasText: name });
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header.locator("span.badge", { hasText: "Ec Review" })).toBeVisible();

    const approveButton = page.getByRole("button", { name: "Approve & run onboarding" });
    await expect(approveButton).toBeVisible();
    await approveButton.click();
    await expect(page.locator(".my-toast", { hasText: "Application approved" })).toBeVisible({ timeout: 15_000 });

    // The click-through's own UI state: the confirm() dialog was accepted
    // (test would otherwise hang on it), the approve call landed (toast
    // above), and the reloaded detail view now shows the post-approval
    // stage with no further transitions available.
    await expect(header.locator("span.badge", { hasText: "Approved" })).toBeVisible();
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
        users: Array<{ email: string; membership: { organizationName: string | null } | null }>;
      };
      return { status: res.status, body };
    }, email);
    expect(usersLookup.status).toBe(200);
    const provisionedUser = usersLookup.body.users.find((u) => u.email === email);
    expect(provisionedUser, JSON.stringify(usersLookup.body)).toBeTruthy();
    expect(provisionedUser?.membership?.organizationName).toBe(orgName);

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
