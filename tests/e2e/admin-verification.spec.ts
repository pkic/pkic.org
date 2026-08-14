/**
 * E2E coverage for: a real-browser verification pass on
 * "built but never browser-verified" admin screens — these all shipped with
 * API/test-level verification only (per their own phase status notes), and
 * this phase's job is only to confirm they actually work end-to-end in a
 * real browser, not to build anything new.
 *
 * Screens covered, one test each: Organizations → Content Review,
 * Mailing Lists, Sponsorships + Events → Settings → Sponsor
 * Tiers, Admin → Votes + → Proposals, Working Groups
 * CRUD (2026-07-27 follow-up), and the Users multi-email/merge panel
 * (2026-07-27 follow-up).
 *
 * Fixture data (an approved org member, an approved individual member) goes
 * through the real public/admin application APIs exactly like
 * votes-and-sponsor.spec.ts and sponsor-portal.spec.ts already do for their
 * own fixtures — an application is created via the public endpoint, walked
 * through its real stage transitions by the signed-in admin, and approved,
 * which provisions a real organization + user. The member then signs in for
 * real via the portal's magic-link flow to produce the content-review /
 * vote-proposal submissions the admin screens under test actually moderate.
 *
 * Admin auth happens exactly once for the whole file (`beforeAll`, saved as
 * `storageState` and reused by every test) rather than per-test: the local
 * env's EMAIL_RATE_LIMITER allows only 3 magic-link requests per 60s per
 * address (wrangler.jsonc), and 8 independent sign-ins for the same
 * admin@pkic.org within that window reliably tripped it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";
const ADMIN_AUTH_FILE = path.join("test-results", "admin-verification-auth.json");

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

function extractUrlFromEmail(email: CapturedEmail, urlSubstring: string): string {
  const content = email.payload.content as Array<{ type: string; value: string }> | undefined;
  const html = content?.find((c) => c.type === "text/html")?.value ?? "";
  const hrefRe = /href="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    if (match[1].includes(urlSubstring)) return match[1];
  }
  throw new Error(`No URL containing "${urlSubstring}" found in email to <${email.to}>`);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin/");
  await expect(page.locator("#form-magic")).toBeVisible({ timeout: 10_000 });
  await page.locator("#inp-email").fill("admin@pkic.org");
  const since = await outboxLength();
  await page.locator("#btn-send").click();
  await expect(page.locator("#magic-sent")).toBeVisible({ timeout: 10_000 });

  const magicEmail = await waitForEmail("admin@pkic.org", "sign-in", { since });
  const magicUrl = extractUrlFromEmail(magicEmail, "/admin/");
  await page.goto(magicUrl);
  await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });
}

/**
 * Walks a freshly-submitted membership application through its real stage
 * transitions (pending → in_review → in_consultation → ec_review) and
 * approves it — the only path that provisions a real organization + user,
 * exactly what member-applications.ts's ALLOWED_STAGE_TRANSITIONS requires.
 * `page` must already be signed in as admin for the stage/approve calls;
 * the initial application submission itself is the public, unauthenticated
 * endpoint.
 */
async function provisionApprovedMember(
  page: Page,
  opts: { email: string; name: string; orgName?: string; category?: string },
): Promise<{ applicationId: string; organizationId: string | null; userId: string }> {
  const category = opts.category ?? "F";
  const created = await page.evaluate(
    async ({ email, name, orgName, category }) => {
      const res = await fetch("/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: email,
          applicantName: name,
          membershipCategory: category,
          organizationName: orgName,
        }),
      });
      const body = (await res.json()) as { applicationId?: string };
      return { status: res.status, body };
    },
    { email: opts.email, name: opts.name, orgName: opts.orgName, category },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const applicationId = created.body.applicationId!;

  for (const toStage of ["in_review", "in_consultation", "ec_review"]) {
    const status = await page.evaluate(
      async ({ applicationId, toStage }) => {
        const res = await fetch(`/api/v1/admin/applications/${applicationId}/stage`, {
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

  const approved = await page.evaluate(async (applicationId) => {
    const res = await fetch(`/api/v1/admin/applications/${applicationId}/approve`, {
      method: "POST",
      credentials: "same-origin",
    });
    const body = (await res.json()) as { organizationId: string | null; userId: string };
    return { status: res.status, body };
  }, applicationId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  return { applicationId, organizationId: approved.body.organizationId, userId: approved.body.userId };
}

/** Signs a member in for real via the portal's magic-link flow. */
async function memberLogin(page: Page, email: string): Promise<void> {
  await page.goto("/portal/");
  await expect(page.locator("#portal-inp-email")).toBeVisible({ timeout: 10_000 });
  await page.locator("#portal-inp-email").fill(email);
  const since = await outboxLength();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText(/you'll receive a sign-in link shortly/i)).toBeVisible();

  const magicEmail = await waitForEmail(email, "sign-in", { since });
  const magicUrl = extractUrlFromEmail(magicEmail, "/portal/");
  await page.goto(magicUrl);
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible({ timeout: 15_000 });
}

test.describe("Admin browser-verification pass", () => {
  test.beforeAll(async ({ browser }) => {
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

  test("mailing lists: create, edit, and delete a list", async ({ page }) => {
    page.on("dialog", (d) => d.accept());

    const stamp = Date.now();
    const email = `e2e-list-${stamp}@lists.pkic.org`;
    const label = `E2E List ${stamp}`;
    const editedLabel = `${label} (edited)`;

    await page.goto("/admin/#/mailing-lists");
    await page.getByRole("button", { name: "Add mailing list" }).click();

    const addForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
    await addForm.locator("input").nth(0).fill(email);
    await addForm.locator("input").nth(1).fill(label);
    await addForm.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".my-toast", { hasText: "Mailing list added" })).toBeVisible();

    const row = page.locator("tr").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText(label, { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    const editForm = page.locator("tr").filter({ has: page.getByRole("button", { name: "Save" }) });
    await editForm.locator("input").nth(1).fill(editedLabel);
    await editForm.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".my-toast", { hasText: "Saved" })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: email }).getByText(editedLabel, { exact: true })).toBeVisible();

    await page.locator("tr").filter({ hasText: email }).getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".my-toast", { hasText: "Deleted" })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(0);
  });

  test("working groups: create, assign chair/vice chair, add/remove member, deactivate/reactivate", async ({
    page,
  }) => {
    page.on("dialog", (d) => d.accept());
    const wgName = `E2E Working Group ${Date.now()}`;

    await page.goto("/admin/#/working-groups");

    const panel = page
      .locator("div.card")
      .filter({ has: page.locator(".card-header", { hasText: "Working group management" }) });
    await expect(panel).toBeVisible();

    await panel.getByRole("button", { name: "+ Create working group" }).click();
    await panel.locator("form").locator("input").first().fill(wgName);
    await panel.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".my-toast", { hasText: "Working group created" })).toBeVisible();

    const wgSelect = panel.locator("select");
    await wgSelect.selectOption({ label: wgName });
    await expect(page.getByText("Roster (0)")).toBeVisible();

    // Assign the seeded admin as chair and vice chair — a real user row,
    // no separate fixture needed for the UserPicker search. Each form also
    // has a datetime-local "expires" input, so scope by placeholder rather
    // than a bare `input` locator to avoid a strict-mode multi-match.
    const chairForm = panel.locator("form").filter({ has: page.getByText("Assign chair") });
    const chairPicker = chairForm.getByPlaceholder("Search by email or name…");
    await chairPicker.fill("admin@pkic.org");
    await expect(chairForm.getByText("admin@pkic.org")).toBeVisible({ timeout: 5_000 });
    await chairForm.getByText("admin@pkic.org").click();
    await chairForm.getByRole("button", { name: "Assign as chair" }).click();
    await expect(page.locator(".my-toast", { hasText: "Chair assigned" })).toBeVisible();
    await expect(panel.getByText("admin@pkic.org").first()).toBeVisible();

    // Add the same admin user to the roster (a distinct code path from
    // chair assignment — a plain working_group_members row).
    const memberForm = panel.locator("form").filter({ has: page.getByText("Add member") });
    const memberPicker = memberForm.getByPlaceholder("Search by email or name…");
    await memberPicker.fill("admin@pkic.org");
    await expect(memberForm.getByText("admin@pkic.org")).toBeVisible({ timeout: 5_000 });
    await memberForm.getByText("admin@pkic.org").click();
    await memberForm.getByRole("button", { name: "Add member" }).click();
    await expect(page.locator(".my-toast", { hasText: "Member added" })).toBeVisible();
    await expect(page.getByText("Roster (1)")).toBeVisible();

    // Scope to the roster <table> specifically — the chair/vice-chair rows
    // above it each have their own "Remove" button too.
    await panel.locator("table").getByRole("button", { name: "Remove" }).first().click();
    await expect(page.locator(".my-toast", { hasText: "Member removed" })).toBeVisible();
    await expect(page.getByText("Roster (0)")).toBeVisible();

    await panel.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.locator(".my-toast", { hasText: "Working group deactivated" })).toBeVisible();
    // The working-group <select>'s own option text also gains an
    // "(inactive)" suffix at this point — scope to the status badge.
    await expect(panel.locator("span.badge", { hasText: "Inactive" })).toBeVisible();

    await panel.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.locator(".my-toast", { hasText: "Working group reactivated" })).toBeVisible();
    await expect(panel.locator("span.badge", { hasText: "Active" })).toBeVisible();
  });

  test("votes: create a vote via the admin UI and manage its visibility/ballots", async ({ page }) => {
    const title = `E2E Admin-created Vote ${Date.now()}`;
    const closesAt = new Date(Date.now() + 86_400_000);
    const closesAtLocal = closesAt.toISOString().slice(0, 16);

    await page.goto("/admin/#/votes");
    await page.getByRole("button", { name: "Create vote" }).click();

    // Labels here aren't `<label for>`-linked to their inputs (no id on
    // either side), so getByLabel can't resolve them — target by the
    // label-then-input sibling structure instead.
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create vote" }) });
    await form.locator('div:has(> label:text-is("Title")) > input').fill(title);
    await form.locator('div:has(> label:text-is("Closes at")) > input').fill(closesAtLocal);
    await form.getByRole("button", { name: "Create vote" }).click();
    await expect(page.locator(".my-toast", { hasText: "Vote created" })).toBeVisible();

    await page.locator(".list-group-item").filter({ hasText: title }).click();
    const detail = page.locator(".card").filter({ has: page.getByRole("heading", { name: title }) });
    await expect(detail).toBeVisible();
    // A blank "opens at" defaults to now, so the vote is immediately open —
    // no cron/due-work run needed (matches votes-and-sponsor.spec.ts).
    await expect(detail.locator("span.badge", { hasText: "open" })).toBeVisible();

    await detail.locator("select").first().selectOption("public");
    await detail.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".my-toast", { hasText: "Visibility updated" })).toBeVisible();

    await detail.getByRole("button", { name: "Load ballots" }).click();
    await expect(detail.getByText("No ballots yet.")).toBeVisible();
  });

  test("vote proposals: a real member submission is moderated (reject guard + approve bypass)", async ({ page }) => {
    // page.evaluate needs a real document loaded first — storageState
    // restores the admin session cookie, but a brand-new page starts on
    // about:blank, where relative-URL fetches have nothing to resolve
    // against.
    await page.goto("/admin/");
    await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });

    // Forum-scope proposal submission requires min_endorsers_for_ballot > 0
    // (submitProposalRouteSchema's own description) — the "Approve (bypass
    // endorsements)" admin action is what's under test, not the normal
    // endorsement-collection path, so 1 is enough to allow submission.
    const settingsStatus = await page.evaluate(async () => {
      const res = await fetch("/api/v1/admin/membership-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ forumVoteMinEndorsers: 1 }),
      });
      return res.status;
    });
    expect(settingsStatus).toBe(200);

    const stamp = Date.now();
    const email = `e2e-proposer-${stamp}@e2e-vote-proposal-${stamp}.test`;
    await provisionApprovedMember(page, { email, name: "Proposer E2E", orgName: `E2E Proposer Org ${stamp}` });
    await memberLogin(page, email);

    const title = `E2E Member Vote Proposal ${stamp}`;
    const submitted = await page.evaluate(async (title) => {
      const res = await fetch("/api/v1/portal/vote-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title,
          description: "An end-to-end test vote proposal.",
          voteType: "motion",
          scopeType: "forum",
        }),
      });
      return { status: res.status, body: await res.text() };
    }, title);
    expect(submitted.status, submitted.body).toBe(200);

    await page.goto("/admin/#/votes");
    await page.getByRole("button", { name: "proposals", exact: true }).click();
    // A single open proposal auto-selects, putting its title on screen
    // twice (list item + detail heading) — scope to the list item.
    const listItem = page.locator(".list-group-item").filter({ hasText: title });
    await expect(listItem).toBeVisible();
    await listItem.click();

    const detail = page.locator(".card").filter({ has: page.getByRole("heading", { name: title }) });
    await expect(detail.getByText("Endorsements: 0 / 1")).toBeVisible();

    await detail.getByRole("button", { name: "Reject" }).click();
    await expect(page.locator(".my-toast", { hasText: "A reason is required to reject" })).toBeVisible();

    await detail.getByRole("button", { name: "Approve (bypass endorsements)" }).click();
    await expect(page.locator(".my-toast", { hasText: "Converted to an active vote" })).toBeVisible();

    await page.getByRole("button", { name: "converted to vote", exact: true }).click();
    await expect(page.locator(".list-group-item").filter({ hasText: title })).toBeVisible();

    // The proposal's approval also created a real vote (Votes tab) — a
    // second, independent confirmation the two screens are wired together.
    await page.getByRole("button", { name: "votes", exact: true }).click();
    await expect(page.locator(".list-group-item").filter({ hasText: title })).toBeVisible();
  });

  test("sponsorships: create an event sponsorship and advance its pipeline stage", async ({ page }) => {
    const contactName = `E2E Sponsor Contact ${Date.now()}`;

    await page.goto("/admin/#/sponsorships");
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

    await page.locator(".list-group-item").filter({ hasText: contactName }).click();
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

  test("organization content review: a real member edit is diffed and approved", async ({ page }) => {
    await page.goto("/admin/");
    await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });

    const stamp = Date.now();
    const email = `e2e-content-review-${stamp}@e2e-content-review-${stamp}.test`;
    const orgName = `E2E Content Review Org ${stamp}`;
    await provisionApprovedMember(page, { email, name: "Content Reviewer E2E", orgName });
    await memberLogin(page, email);

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

    await page.goto("/admin/#/organizations/content-reviews");
    // A single pending review auto-selects, so its org name is already on
    // screen twice (list item + detail heading) by the time this loads —
    // scope to the list item specifically rather than a bare getByText.
    const listItem = page.locator(".list-group-item").filter({ hasText: orgName });
    await expect(listItem).toBeVisible({ timeout: 15_000 });
    await listItem.click();

    const detail = page.locator(".card").filter({ has: page.getByText(orgName) });
    await expect(detail.getByText("Slogan", { exact: true })).toBeVisible();
    await expect(detail.getByText(newSlogan)).toBeVisible();

    // Rejecting without a note is blocked client-side — confirms the
    // required-note guard without spending this org's one pending review.
    await detail.getByRole("button", { name: "Reject" }).click();
    await expect(page.locator(".my-toast", { hasText: "A reviewer note is required to reject" })).toBeVisible();

    await detail.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator(".my-toast", { hasText: "Approved and applied" })).toBeVisible();

    await page.getByRole("button", { name: "approved", exact: true }).click();
    await expect(page.locator(".list-group-item").filter({ hasText: orgName })).toBeVisible();
  });

  test("users: multi-email panel and merging a duplicate account", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/admin/");
    await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });

    const stamp = Date.now();
    const primaryEmail = `e2e-primary-${stamp}@e2e-users-${stamp}.test`;
    const duplicateEmail = `e2e-duplicate-${stamp}@e2e-users-dup-${stamp}.test`;
    const extraEmail = `e2e-secondary-${stamp}@e2e-users-${stamp}.test`;

    await provisionApprovedMember(page, {
      email: primaryEmail,
      name: `Primary User ${stamp}`,
      orgName: `E2E Users Org ${stamp}`,
    });

    // The "duplicate" account must be a bare user with no membership —
    // POST /api/v1/admin/users/:id/merge rejects BOTH_HOLD_MEMBERSHIP when
    // both sides have one (confirmed by a first attempt at this test using
    // a second provisionApprovedMember, which 409'd for exactly that
    // reason). A real event registration (same technique
    // sponsor-portal.spec.ts uses for its attendee fixture) creates a
    // plain `users` row with no membership attached.
    const registerStatus = await page.evaluate(
      async ({ slug, email }) => {
        const res = await fetch(`/api/v1/events/${slug}/registrations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Duplicate",
            lastName: `User ${Date.now()}`,
            email,
            attendanceType: "virtual",
            customAnswers: { organization_name: "Duplicate Org", job_title: "Engineer", country: "NL" },
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
              { termKey: "photo-policy", version: "v1" },
            ],
          }),
        });
        return res.status;
      },
      { slug: EVENT_SLUG, email: duplicateEmail },
    );
    expect(registerStatus).toBe(200);

    const confirmEmail = await waitForEmail(duplicateEmail, "confirm your registration");
    const confirmUrl = extractUrlFromEmail(confirmEmail, "/confirm/");
    const confirmParams = new URL(confirmUrl, "http://127.0.0.1:8788").searchParams;
    const confirmStatus = await page.evaluate(
      async ({ slug, token, id }) => {
        const url = `/api/v1/events/${slug}/registrations/confirm-email?token=${encodeURIComponent(token)}${
          id ? `&id=${encodeURIComponent(id)}` : ""
        }`;
        const res = await fetch(url);
        return res.status;
      },
      { slug: EVENT_SLUG, token: confirmParams.get("token") ?? "", id: confirmParams.get("id") },
    );
    expect(confirmStatus).toBe(200);

    await page.goto("/admin/#/users");
    await page.getByPlaceholder("email or name").fill(primaryEmail);
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

    const mergePanel = page
      .locator(".card")
      .filter({ has: page.locator(".card-header", { hasText: "Merge another account into this one" }) });
    await mergePanel.locator("input").fill(duplicateEmail);
    await expect(mergePanel.getByText(duplicateEmail)).toBeVisible({ timeout: 5_000 });
    await mergePanel.getByText(duplicateEmail).click();
    await mergePanel.getByRole("button", { name: "Merge into this account" }).click();
    await expect(page.locator(".my-toast", { hasText: "Accounts merged" })).toBeVisible({ timeout: 10_000 });

    await expect(emailPanel.getByText(duplicateEmail)).toBeVisible();
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
