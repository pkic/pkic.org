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
import type { BrowserContext, Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { waitForCapturedEmail } from "./helpers/sendgrid";
import { declinePasskeyOffer } from "./helpers/portal-auth";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { endEventSponsor } from "./helpers/event-sponsor";
import { ownDomainEmail, registerInBrowser } from "./helpers/registration";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { sponsorAttendeesListResponseSchema } from "../../assets/shared/schemas/sponsor-access";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
const EVENT_SLUG = "pqc-conference-amsterdam-nl";

function sendgridServer(): string {
  return process.env.E2E_SENDGRID_API_BASE ?? readFileSync(SENDGRID_URL_FILE, "utf8").trim();
}

async function readOutbox(): Promise<CapturedEmail[]> {
  const response = await fetch(`${sendgridServer()}/outbox`);
  return (await response.json()) as CapturedEmail[];
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
  /** The sponsorship this test activated, and the staff session that may end it. */
  let attendeeContext: BrowserContext | undefined;
  let activeSponsorship: { id: string; staff: Awaited<ReturnType<BrowserContext["storageState"]>> } | undefined;

  test.afterEach(async ({ browser }, info) => {
    await attendeeContext?.close();
    attendeeContext = undefined;
    if (!activeSponsorship) return;
    const staffContext = await browser.newContext({
      baseURL: info.project.use.baseURL,
      storageState: activeSponsorship.staff,
    });
    try {
      await endEventSponsor(await staffContext.newPage(), activeSponsorship.id);
    } finally {
      activeSponsorship = undefined;
      await staffContext.close();
    }
  });

  test("magic-link access, attendee list + CSV export, sign out, and slug-based link re-request", async ({
    page,
    browser,
  }, info) => {
    const stamp = Date.now();
    const contactEmail = `sponsor-e2e-${stamp}@example.test`;
    const attendeeEmail = ownDomainEmail("sponsor-disclosure");
    const organizationName = `Synthetic Disclosure Services ${stamp}`;
    const personalEmail = `synthetic-sponsor-${stamp}@gmail.com`;
    const deniedEmail = ownDomainEmail("sponsor-no-sharing");
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
        return { id: created.sponsorship.id, createStatus: createRes.status, stageStatus: stageRes.status };
      },
      { eventId: event.id, contactEmail, renewalDate },
    );
    expect(sponsorship.createStatus).toBe(201);
    activeSponsorship = { id: sponsorship.id, staff: await page.context().storageState() };
    expect(sponsorship.stageStatus).toBe(200);

    attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const attendee = await attendeeContext.newPage();
    const optIn = async (form: Page) => {
      await form.getByRole("checkbox", { name: /sharing my professional profile with event sponsors/ }).check();
    };
    const workRegistration = await registerInBrowser(attendee, attendeeEmail, undefined, undefined, {
      organization: organizationName,
      onReviewReady: optIn,
    });
    const personalRegistration = await registerInBrowser(attendee, personalEmail, undefined, undefined, {
      individual: true,
      onReviewReady: optIn,
    });
    await registerInBrowser(attendee, deniedEmail, undefined, undefined, {
      organization: `Synthetic Private Services ${stamp}`,
    });

    // ── Sponsor clicks the capability-bearing unified portal link ──────────
    const accessEmail = await waitForCapturedEmail(contactEmail, "sponsor workspace");
    const portalUrl = extractUrlFromEmail(accessEmail, "/portal/#/verify");

    // The setup identity must not mask the sponsor-only session established
    // by this capability link. Navigate away first because a same-document
    // fragment change does not remount the portal application.
    await page.context().clearCookies();
    await page.goto("/");
    await page.goto(portalUrl);
    await declinePasskeyOffer(page);
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
    await expect(page.getByText(personalEmail, { exact: true })).toBeVisible();
    await expect(page.getByText(deniedEmail, { exact: true })).toBeHidden();
    await expect(
      page.getByRole("row").filter({ hasText: personalEmail }).getByText("Personal email address", { exact: true }),
    ).toBeVisible();
    const endpoint = `/api/v1/sponsors/${sponsorship.id}/events/${event.id}/attendees`;
    const rosterResponse = await page.request.get(endpoint);
    expect(rosterResponse.status()).toBe(200);
    const raw = await rosterResponse.json();
    const roster = sponsorAttendeesListResponseSchema.parse(raw);
    expect(roster.attendees.find((row) => row.email === attendeeEmail)).toMatchObject({
      organizationName,
      jobTitle: "Conference attendee",
    });
    for (const row of raw.attendees) {
      expect(Object.keys(row).sort()).toEqual(
        ["firstName", "lastName", "email", "organizationName", "jobTitle", "personalEmail"].sort(),
      );
    }
    expect(roster.attendees.find((row) => row.email === personalEmail)).toMatchObject({
      organizationName: null,
      personalEmail: true,
    });
    for (const [width, height, device] of [
      [1280, 900, "desktop"],
      [375, 812, "phone"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: info.outputPath(`sponsor-disclosure-${device}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    // ── CSV export via the real download link ──────────────────────────────
    const csvLink = page.getByRole("link", { name: "Download consenting attendees (CSV)", exact: true });
    const csvEndpoint = await csvLink.getAttribute("href");
    expect(csvEndpoint).not.toBeNull();
    const downloadPromise = page.waitForEvent("download");
    await csvLink.click();
    const download = await downloadPromise;
    const csvPath = await download.path();
    const csv = readFileSync(csvPath as string, "utf8");
    expect(csv).toContain(attendeeEmail);
    expect(csv).toContain(personalEmail);
    expect(csv).toContain("Personal email address");
    expect(csv).not.toContain(deniedEmail);
    expect(csv.split(/\r?\n/)[0]).toBe("First name,Last name,Email,Organization,Job title,Personal email address");
    expect(csv).not.toContain(workRegistration.result.registrationId);
    expect(csv).not.toContain(personalRegistration.result.registrationId);

    // The browser is still signed in as the last registrant; consent is withdrawn by its owner alone, from their own link.
    await attendee.context().clearCookies();
    await attendee.goto((await personalRegistration.manageLink()).manageUrl);
    await attendee.getByRole("button", { name: "Withdraw sharing…", exact: true }).click();
    await acceptConfirmDialog(attendee, "Withdraw sharing");
    await expect(attendee.getByText("Sharing withdrawn", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(personalEmail, { exact: true })).toBeHidden();
    await expect(page.getByText(attendeeEmail, { exact: true })).toBeVisible();
    const withdrawnCsv = await (await page.request.get(csvEndpoint!)).text();
    expect(withdrawnCsv).not.toContain(personalEmail);

    // ── Sign out clears the canonical session; a fresh visit is anonymous ─
    // Sign out now lives in the sidebar footer's account menu rather than as
    // a standalone button.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/portal\/#\/sponsors$/);
    // Sign-out retains the sponsor destination, whose anonymous entry is
    // the shared sign-in card titled for it rather than an authorized attendee view.
    await expect(page.getByRole("heading", { name: "Sponsor access", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: /^Consenting attendees for/ })).toHaveCount(0);
    await expect(page.getByText(attendeeEmail, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sponsor access", exact: true })).toBeVisible();
    expect((await page.request.get(csvEndpoint!)).status()).toBe(401);

    // ── Asking for a new link: a sponsor contact signs in from the same
    // card as everyone else and returns to the sponsor destination ─────────
    const resendAfterIndex = (await readOutbox()).length;
    await page.goto("/");
    await page.goto("/portal/#/sponsors");
    await expect(page.getByRole("heading", { name: "Sponsor access", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign in with an email link" }).click();
    await page.getByLabel("Email").fill(contactEmail);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText(/you'll receive a sign-in link shortly/i)).toBeVisible();

    const resendEmail = await waitForCapturedEmail(contactEmail, "sign-in link", { since: resendAfterIndex });
    const resendUrl = extractUrlFromEmail(resendEmail, "/portal/#/verify");
    expect(resendUrl).not.toBe(portalUrl);

    await page.goto("/");
    await page.goto(resendUrl);
    await declinePasskeyOffer(page);
    await expect(page.getByText(attendeeEmail)).toBeVisible({ timeout: 15_000 });
  });
});
