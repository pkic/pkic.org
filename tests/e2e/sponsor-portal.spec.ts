/**
 * E2E coverage for: the sponsor portal frontend (magic-link login,
 * attendee list, CSV export) at /sponsor-portal/ — "Sponsor
 * Portal — Attendee Data Access".
 *
 * All setup (event sponsor-tier config, sponsorship creation + activation,
 * a consenting attendee registration) goes through the real admin/public
 * APIs against the seeded `pqc-conference-amsterdam-nl` event, exactly like
 * votes-and-sponsor.spec.ts's approach — only the sponsor-portal screens
 * themselves (Login, Attendees, CSV download, sign-out) are exercised
 * through the real rendered UI.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";

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

test.describe("sponsor portal", () => {
  test("magic-link access, attendee list + CSV export, sign out, and slug-based link re-request", async ({ page }) => {
    const stamp = Date.now();
    const contactEmail = `sponsor-e2e-${stamp}@example.test`;
    const attendeeEmail = `sponsor-e2e-attendee-${stamp}@example.test`;

    await signInAsAdmin(page);

    // ── Resolve the seeded event's internal id + configure Leader tier ────
    const event = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/admin/events/${slug}`, { credentials: "same-origin" });
      const body = (await res.json()) as { event: { id: string } };
      return body.event;
    }, EVENT_SLUG);

    const tierStatus = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/admin/events/${slug}/sponsor-tiers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
      });
      return res.status;
    }, EVENT_SLUG);
    expect(tierStatus).toBe(200);

    // ── Create + activate an event sponsorship (triggers sponsor-portal-access email) ─
    const sponsorship = await page.evaluate(
      async ({ eventId, contactEmail }) => {
        const createRes = await fetch("/api/v1/admin/sponsorships", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            sponsorType: "event",
            eventId,
            tier: "Leader",
            contactEmail,
            contactName: "E2E Sponsor Contact",
          }),
        });
        const created = (await createRes.json()) as { sponsorship: { id: string } };
        const stageRes = await fetch(`/api/v1/admin/sponsorships/${created.sponsorship.id}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage: "active" }),
        });
        return { createStatus: createRes.status, stageStatus: stageRes.status };
      },
      { eventId: event.id, contactEmail },
    );
    expect(sponsorship.createStatus).toBe(201);
    expect(sponsorship.stageStatus).toBe(200);

    // ── Register a consenting attendee via the real public registration API ─
    const registration = await page.evaluate(
      async ({ slug, attendeeEmail }) => {
        const res = await fetch(`/api/v1/events/${slug}/registrations`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Casey",
            lastName: "Attendee",
            email: attendeeEmail,
            attendanceType: "virtual",
            // organization_name/job_title/country are this event's own
            // required custom registration fields (seeded via
            // scripts/seed-event.yaml's "pqc-2026-registration" form) — the
            // first two are also promoted onto the user profile by the
            // registration service (see registrations.ts's
            // profileFromCustom), which is what the sponsor portal's
            // attendee list actually reads.
            customAnswers: { organization_name: "Attendee Org", job_title: "Engineer", country: "NL" },
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
              { termKey: "photo-policy", version: "v1" },
              { termKey: "sponsor-data-sharing", version: "v1" },
            ],
          }),
        });
        return { status: res.status, body: await res.text() };
      },
      { slug: EVENT_SLUG, attendeeEmail },
    );
    expect(registration.status, registration.body).toBe(200);

    // Self-registration starts pending_email_confirmation — only
    // status='registered' rows are sponsor-data eligible (see
    // listSponsorPortalAttendees) — so confirm it via the same link the
    // attendee would receive by email, hit directly as a GET (its query
    // params are the same either way; skips rendering the confirm page,
    // which isn't part of what this phase tests).
    const confirmEmail = await waitForEmail(attendeeEmail, "confirm your registration");
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

    // ── Sponsor clicks the sponsor-portal-access magic link ────────────────
    const accessEmail = await waitForEmail(contactEmail, "sponsor portal");
    const portalUrl = extractUrlFromEmail(accessEmail, "/sponsor-portal/");

    await page.goto(portalUrl);
    await expect(page.getByRole("heading", { name: `Attendees — Post-Quantum Cryptography Conference` })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Leader sponsor")).toBeVisible();
    await expect(page.getByText(attendeeEmail)).toBeVisible();
    await expect(page.getByText("Casey Attendee")).toBeVisible();

    // ── CSV export via the real download link ──────────────────────────────
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    const download = await downloadPromise;
    const csvPath = await download.path();
    const csv = readFileSync(csvPath as string, "utf8");
    expect(csv).toContain(attendeeEmail);
    expect(csv).toContain("Casey");

    // ── Sign out clears the session; a fresh visit shows the login form ────
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sponsor Portal" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sponsor Portal" })).toBeVisible();

    // ── Self-service "request a new link" flow, keyed by the event's public
    // slug rather than its internal id (a sponsor
    // contact only ever knows the slug) ────────────────────────────────────
    await page.locator("#sp-inp-email").fill(contactEmail);
    await page.locator("#sp-inp-event").fill(EVENT_SLUG);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText(/you'll receive a sign-in link shortly/i)).toBeVisible();

    const resendEmail = await waitForEmail(contactEmail, "sponsor portal");
    const resendUrl = extractUrlFromEmail(resendEmail, "/sponsor-portal/");
    expect(resendUrl).not.toBe(portalUrl);

    await page.goto(resendUrl);
    await expect(page.getByText(attendeeEmail)).toBeVisible({ timeout: 15_000 });
  });
});
