/**
 * E2E coverage for: the public votes pages (/votes/, /votes/detail/)
 * and the event-scoped "Sponsor Now" self-service checkout widget.
 *
 * Votes: a real vote is created and made public through the actual admin
 * API (proving the public GET /api/v1/votes(/:slug) endpoints and the new
 * frontend are wired together end-to-end), while the "closed with results"
 * rendering branches are exercised via mocked responses — this environment
 * has no way to fast-forward the 15-minute due-work cron that tallies and
 * closes a vote locally, and votes.test.ts already covers that tallying
 * logic at the service layer.
 *
 * Sponsor checkout: Stripe isn't configured in local dev (no
 * STRIPE_SECRET_KEY in .dev.vars, same gap already documented for the
 * donation flow), so the checkout-session creation call is mocked to
 * return a same-origin redirect URL, verifying the form submits the
 * right payload and follows the returned URL.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";

function sendgridServer(): string {
  return process.env.E2E_SENDGRID_API_BASE ?? readFileSync(SENDGRID_URL_FILE, "utf8").trim();
}

async function waitForEmail(to: string, subjectFragment: string, timeoutMs = 15_000): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  let lastEmails: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    const resp = await fetch(`${sendgridServer()}/outbox`);
    lastEmails = (await resp.json()) as CapturedEmail[];
    for (let i = lastEmails.length - 1; i >= 0; i--) {
      const e = lastEmails[i];
      if (e.to === to && e.subject.toLowerCase().includes(subjectFragment.toLowerCase())) {
        return e;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `No email to <${to}> with subject containing "${subjectFragment}" within ${timeoutMs}ms. ` +
      `Outbox has ${lastEmails.length} email(s).`,
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
  await page.locator("#btn-send").click();
  await expect(page.locator("#magic-sent")).toBeVisible({ timeout: 10_000 });

  const magicEmail = await waitForEmail("admin@pkic.org", "sign-in");
  const magicUrl = extractUrlFromEmail(magicEmail, "/admin/");
  await page.goto(magicUrl);
  await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });
}

test.describe("public votes pages", () => {
  test("lists a real open public vote and renders mocked closed motion/election results", async ({ page }) => {
    // Expected 4xx noise: an unauthenticated session probe (401) and the
    // deliberate not-found lookup below (404) — same ignore convention as
    // browser-rendering.spec.ts's monitorErrors.
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const t = msg.text();
        if (
          !/\[vite\]|\[HMR\]|favicon|net::ERR_ABORTED/.test(t) &&
          !/Failed to load resource: the server responded with a status of 4/.test(t)
        ) {
          consoleErrors.push(t);
        }
      }
    });

    await signInAsAdmin(page);

    const title = `E2E Public Motion Vote ${Date.now()}`;
    const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const created = await page.evaluate(
      async ({ title, closesAt }) => {
        const res = await fetch("/api/v1/admin/votes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            title,
            description: "An end-to-end test motion vote.",
            voteType: "motion",
            scopeType: "forum",
            thresholdType: "simple_majority",
            closesAt,
          }),
        });
        const body = (await res.json()) as { vote?: { id: string; slug: string } };
        return { status: res.status, vote: body.vote };
      },
      { title, closesAt },
    );
    expect(created.status).toBe(200);
    const slug = created.vote!.slug;

    const visibilityStatus = await page.evaluate(async (voteId) => {
      const res = await fetch(`/api/v1/admin/votes/${voteId}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ visibility: "public", publicDetailLevel: "aggregate" }),
      });
      return res.status;
    }, created.vote!.id);
    expect(visibilityStatus).toBe(200);

    // ── Index page shows the real open vote ─────────────────────────────
    await page.goto("/votes/");
    await expect(page.getByRole("heading", { name: "Open for voting" })).toBeVisible();
    await expect(page.getByText(title)).toBeVisible();

    // ── Detail page (real backend) — not yet closed, no result shown ─────
    // The card is clickable via Bootstrap's stretched-link pattern (an <a>
    // whose ::after pseudo-element covers the card) — Playwright's own
    // actionability check sees the <a> itself as zero-size, so click the
    // card container instead, mirroring how a real click lands on it.
    await page.locator(".member-card").filter({ hasText: title }).click();
    await expect(page).toHaveURL(new RegExp(`/votes/detail/\\?slug=${slug}`));
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/Results will be published here once voting closes/i)).toBeVisible();

    // ── Not-found (real backend, unknown slug) ───────────────────────────
    await page.goto("/votes/detail/?slug=does-not-exist-e2e");
    await expect(page.getByText(/couldn.t find that vote/i)).toBeVisible();

    // ── Mocked closed motion result ───────────────────────────────────────
    await page.route("**/api/v1/votes/mocked-closed-motion", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          vote: {
            id: "mock-motion-1",
            slug: "mocked-closed-motion",
            title: "Mocked Closed Motion",
            description: "A mocked, already-closed motion vote.",
            voteType: "motion",
            scopeType: "forum",
            opensAt: new Date(Date.now() - 172_800_000).toISOString(),
            closesAt: new Date(Date.now() - 86_400_000).toISOString(),
            status: "closed",
            candidates: null,
            result: {
              thresholdType: "simple_majority",
              counts: { in_favor: 23, opposed: 4, abstain: 2 },
              totalBallots: 29,
              outcome: "passed",
            },
          },
        }),
      });
    });
    await page.goto("/votes/detail/?slug=mocked-closed-motion");
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();
    await expect(page.getByText(/23 in favor.*4 opposed.*2 abstained.*29 ballots cast/)).toBeVisible();

    // ── Mocked closed election result ────────────────────────────────────
    await page.route("**/api/v1/votes/mocked-closed-election", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          vote: {
            id: "mock-election-1",
            slug: "mocked-closed-election",
            title: "Mocked WG Chair Election",
            description: "A mocked, already-closed election vote.",
            voteType: "election",
            scopeType: "working_group",
            opensAt: new Date(Date.now() - 172_800_000).toISOString(),
            closesAt: new Date(Date.now() - 86_400_000).toISOString(),
            status: "closed",
            candidates: [
              { id: "cand-1", candidateName: "Alice Candidate" },
              { id: "cand-2", candidateName: "Bob Candidate" },
            ],
            result: {
              rounds: [{ round: 1, counts: { "cand-1": 12, "cand-2": 8 }, eliminatedCandidateIds: ["cand-2"] }],
              winnerCandidateId: "cand-1",
            },
          },
        }),
      });
    });
    await page.goto("/votes/detail/?slug=mocked-closed-election");
    await expect(page.getByText("Elected", { exact: true })).toBeVisible();
    await expect(page.getByText("Alice Candidate").first()).toBeVisible();
    await expect(page.getByText(/Bob Candidate: 8/)).toBeVisible();
    await expect(page.getByText(/\(eliminated\)/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("event sponsor self-service checkout (Path B)", () => {
  test("submits the Sponsor Now form and follows the returned Stripe checkout redirect", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/api/v1/sponsorship/checkout", async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "/events/2026/pqc-conference-amsterdam-nl/sponsors/complete/?session_id=cs_test_mocked",
        }),
      });
    });

    await page.goto("/events/2026/pqc-conference-amsterdam-nl/sponsors/");
    await expect(page.getByRole("heading", { name: "Sponsor Now" })).toBeVisible();

    await page.locator("label[for='tier-Innovator']").click();
    await page.locator("#sponsorFirstName").fill("Casey");
    await page.locator("#sponsorLastName").fill("Sponsor");
    await page.locator("#sponsorEmail").fill("casey-sponsor@example.test");
    await page.locator("#sponsorOrganizationName").fill("Example Sponsor Org");

    await page.getByRole("button", { name: /Sponsor Now/i }).click();

    await expect(page).toHaveURL(/sponsors\/complete\/\?session_id=cs_test_mocked/);
    await expect(page.getByRole("heading", { name: /Thank you for sponsoring/i })).toBeVisible();

    expect(capturedBody).toMatchObject({
      contactName: "Casey Sponsor",
      contactEmail: "casey-sponsor@example.test",
      organizationName: "Example Sponsor Org",
      tier: "Innovator",
      eventId: "pqc-conference-amsterdam-nl",
    });
    expect(capturedBody!.successPath).toMatch(/\/sponsors\/complete\/$/);
    expect(capturedBody!.cancelPath).toMatch(/\/sponsors\/$/);
  });
});
