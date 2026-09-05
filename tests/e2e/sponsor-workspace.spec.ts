/**
 * E2E coverage for sponsor-capacity access through the unified portal:
 * magic-link login, attendee list, CSV export, and canonical logout.
 *
 * All setup (event sponsor-tier config, sponsorship creation + activation,
 * a consenting attendee registration) goes through the real admin/public
 * APIs against the seeded `pqc-conference-amsterdam-nl` event, exactly like
 * votes-and-sponsor.spec.ts's approach. Sponsor access is exercised through
 * the same /portal/ application and /auth session used by staff and members.
 *
 * @covers sponsor.2.4
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";

function sendgridServer(): string {
  return process.env.E2E_SENDGRID_API_BASE ?? readFileSync(SENDGRID_URL_FILE, "utf8").trim();
}

async function readOutbox(): Promise<CapturedEmail[]> {
  const response = await fetch(`${sendgridServer()}/outbox`);
  return (await response.json()) as CapturedEmail[];
}

async function waitForEmail(
  to: string,
  subjectFragment: string,
  timeoutMs = 15_000,
  afterIndex = 0,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  let lastEmails: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    lastEmails = await readOutbox();
    for (let i = lastEmails.length - 1; i >= afterIndex; i--) {
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
  await signInAsE2eStaff(page, e2eAdminEmail("sponsor-workspace"));
}

test.describe("portal sponsor workspace", () => {
  test("magic-link access, attendee list + CSV export, sign out, and slug-based link re-request", async ({ page }) => {
    const stamp = Date.now();
    const contactEmail = `sponsor-e2e-${stamp}@example.test`;
    const attendeeEmail = `sponsor-e2e-attendee-${stamp}@example.test`;
    const renewalDate = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);

    await signInAsAdmin(page);

    // ── Resolve the seeded event's internal id + configure Leader tier ────
    const event = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/events/${slug}`, { credentials: "same-origin" });
      const body = (await res.json()) as { event: { id: string } };
      return body.event;
    }, EVENT_SLUG);

    const tierStatus = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/events/${slug}/sponsors/tiers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ tiers: [{ tierName: "Leader", hasAttendeeDataAccess: true }] }),
      });
      return res.status;
    }, EVENT_SLUG);
    expect(tierStatus).toBe(200);

    // ── Create + activate an event sponsorship (triggers sponsor access email) ─
    const sponsorship = await page.evaluate(
      async ({ eventId, contactEmail, renewalDate }) => {
        const createRes = await fetch("/api/v1/sponsors", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            sponsorType: "event",
            eventId,
            tier: "Leader",
            contactEmail,
            contactName: "E2E Sponsor Contact",
            renewalDate,
          }),
        });
        const created = (await createRes.json()) as { sponsorship: { id: string } };
        const stageRes = await fetch(`/api/v1/sponsors/${created.sponsorship.id}/stage`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ toStage: "active" }),
        });
        return { createStatus: createRes.status, stageStatus: stageRes.status };
      },
      { eventId: event.id, contactEmail, renewalDate },
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
            // profileFromCustom), which is what the sponsor workspace's
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
    // attendee projection) — so confirm it via the same link the
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

    // ── Sponsor clicks the capability-bearing unified portal link ──────────
    const accessEmail = await waitForEmail(contactEmail, "sponsor workspace");
    const portalUrl = extractUrlFromEmail(accessEmail, "/portal/#/verify");

    // The setup identity must not mask the sponsor-only session established
    // by this capability link. Navigate away first because a same-document
    // fragment change does not remount the portal application.
    await page.context().clearCookies();
    await page.goto("/");
    await page.goto(portalUrl);
    await expect(page).toHaveURL(/\/portal\/#\/sponsors$/);
    // The page header names the section once ("Sponsors"); the event is the
    // header's context line and the attendee table's own caption, so the event
    // name is asserted where it now lives instead of in a fused title.
    await expect(page.getByRole("heading", { name: "Sponsors" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("table", { name: "Consenting attendees for Post-Quantum Cryptography Conference" }),
    ).toBeVisible();
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

    // ── Sign out clears the canonical session; a fresh visit is anonymous ─
    // Sign out now lives in the sidebar footer's account menu rather than as
    // a standalone button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/portal\/$/);
    await expect(page.getByRole("heading", { name: "PKI Consortium Portal" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "PKI Consortium Portal" })).toBeVisible();

    // ── Self-service "request a new link" flow, keyed by the event's public
    // slug rather than its internal id (a sponsor
    // contact only ever knows the slug) ────────────────────────────────────
    const resendAfterIndex = (await readOutbox()).length;
    await page.goto("/");
    await page.goto(`/portal/#/sponsors/access?event=${encodeURIComponent(EVENT_SLUG)}`);
    await expect(page.getByRole("heading", { name: "Sponsor access" })).toBeVisible();
    // By accessible name rather than by id: the two controls are design-system
    // Fields now, which own their own `for`/`id` pair.
    await page.getByLabel("Email").fill(contactEmail);
    await expect(page.getByLabel("Event")).toHaveValue(EVENT_SLUG);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText(/you'll receive a sign-in link shortly/i)).toBeVisible();

    const resendEmail = await waitForEmail(contactEmail, "sponsor workspace", 15_000, resendAfterIndex);
    const resendUrl = extractUrlFromEmail(resendEmail, "/portal/#/verify");
    expect(resendUrl).not.toBe(portalUrl);

    await page.goto("/");
    await page.goto(resendUrl);
    await expect(page.getByText(attendeeEmail)).toBeVisible({ timeout: 15_000 });
  });
});
