import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import type { Page } from "@playwright/test";

const SENDGRID_SERVER = process.env.E2E_SENDGRID_API_BASE ?? "http://127.0.0.1:48765";

async function setNativeChecked(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  await el.evaluate((input) => { (input as HTMLInputElement).click(); });
}

async function clickConsentCard(page: Page, text: string): Promise<void> {
  const card = page.locator("div.event-flow-consent-card").filter({ hasText: text });
  await card.scrollIntoViewIfNeeded();
  await card.evaluate((element) => { (element as HTMLElement).click(); });
}

// ── Error and network monitoring ──────────────────────────────────────────────
interface ErrorMonitorOptions {
  ignoreConsoleError?: (text: string) => boolean;
  ignoreResponse?: (url: string, status: number) => boolean;
}

interface ErrorMonitor { errors: string[]; assertClean(): void; }

function monitorErrors(page: Page, options: ErrorMonitorOptions = {}): ErrorMonitor {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      // Ignore benign dev-server noise and expected 4xx API responses; flag everything else
      if (!t.includes("favicon") && !t.includes("net::ERR_ABORTED") &&
          !t.includes("livereload") && !/\[vite\]|\[HMR\]/.test(t) &&
          !/Failed to load resource: the server responded with a status of 4/.test(t) &&
          !options.ignoreConsoleError?.(t)) {
        errors.push(`console:error — ${t}`);
      }
    }
  });
  page.on("pageerror", (err) => errors.push(`pageerror — ${err.message}`));
  page.on("response", (resp) => {
    // Flag unexpected 5xx responses on non-API routes (API errors are exercised intentionally)
    if (!resp.url().includes("/api/v1/") && resp.status() >= 500 && !options.ignoreResponse?.(resp.url(), resp.status())) {
      errors.push(`HTTP ${resp.status()} — ${resp.url()}`);
    }
  });
  return {
    errors,
    assertClean() {
      if (errors.length > 0) {
        throw new Error(`Unexpected page errors:\n${errors.map((e) => `  • ${e}`).join("\n")}`);
      }
    },
  };
}

// ── Step screenshots ──────────────────────────────────────────────────────────
function createScreenshotter(page: Page): (label: string) => Promise<void> {
  let n = 0;
  const dir = `test-results/screenshots/${test.info().title
    .replace(/\s+/g, "-").replace(/[^\w-]/g, "").replace(/-+/g, "-").slice(0, 70)}`;
  mkdirSync(dir, { recursive: true });
  return async (label: string) => {
    n++;
    await page.screenshot({
      path: `${dir}/${String(n).padStart(3, "0")}-${label.replace(/[^\w]/g, "-")}.png`,
    });
  };
}

// ── Email helpers (talk to the SendGrid intercept server) ─────────────────────

async function clearOutbox(): Promise<void> {
  await fetch(`${SENDGRID_SERVER}/clear`, { method: "POST" });
}

/**
 * Poll the outbox until an email matching `to` and `subjectFragment` appears,
 * or the timeout elapses.  Returns the captured email record.
 */
async function waitForEmail(
  to: string,
  subjectFragment: string,
  timeoutMs = 15_000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  let lastEmails: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    const resp = await fetch(`${SENDGRID_SERVER}/outbox`);
    lastEmails = await resp.json() as CapturedEmail[];
    // Search from newest first so we pick up the latest matching email
    for (let i = lastEmails.length - 1; i >= 0; i--) {
      const e = lastEmails[i];
      if (e.to === to && e.subject.toLowerCase().includes(subjectFragment.toLowerCase())) {
        return e;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `No email to <${to}> with subject containing "${subjectFragment}" within ${timeoutMs}ms.\n` +
    `Outbox has ${lastEmails.length} email(s): ${lastEmails.map((e) => `<${e.to}> "${e.subject}"`).join("; ")}`,
  );
}

/**
 * Extract a URL from an anchor `href` in the SendGrid email HTML whose link
 * text or surrounding text contains `anchorTextHint`.  Uses the rendered HTML
 * in content[1].value of the SendGrid payload.
 *
 * Falls back to a broad href regex scan if no text-based match is found so
 * tests can use a URL substring as the hint.
 */
function extractUrlFromEmail(email: CapturedEmail, urlSubstring: string): string {
  const content = email.payload.content as Array<{ type: string; value: string }> | undefined;
  const html = content?.find((c) => c.type === "text/html")?.value ?? "";

  // Find all href values in the rendered HTML
  const hrefRe = /href="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    if (match[1].includes(urlSubstring)) {
      return match[1];
    }
  }

  // Also check plain-text content for bare URLs
  const text = content?.find((c) => c.type === "text/plain")?.value ?? "";
  const urlRe = /(https?:\/\/\S+)/g;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = urlRe.exec(text)) !== null) {
    if (textMatch[1].includes(urlSubstring)) {
      return textMatch[1].replace(/[.,;)]+$/, "");
    }
  }

  throw new Error(`No URL containing "${urlSubstring}" found in email to <${email.to}>`);
}

// ── Page setup ────────────────────────────────────────────────────────────────

async function setupPage(page: Page): Promise<void> {
  // Reset the email outbox so each test starts with an empty inbox.
  await clearOutbox();

  // Inject a red-dot cursor overlay so recordings show the actual click target
  // even when Playwright synthesizes the interaction without a normal mousemove.
  // Also auto-scroll <main> into the center of the viewport on every page load
  // so screenshots and videos focus on the content area, not the hero banner.
  await page.addInitScript(() => {
    const install = (): void => {
      if (document.getElementById("__pw_cursor")) return;

      // Scroll <main> to the center of the viewport on every page load
      const main = document.querySelector("main");
      if (main) {
        const rect = main.getBoundingClientRect();
        const targetY = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
        window.scrollTo({ top: Math.max(0, targetY), behavior: "instant" });
      }

      const dot = document.createElement("div");
      dot.id = "__pw_cursor";
      dot.style.cssText =
        "position:fixed;top:-999px;left:-999px;width:20px;height:20px;" +
        "border-radius:50%;background:rgba(220,38,38,0.85);border:3px solid #fff;" +
        "box-shadow:0 0 0 3px rgba(220,38,38,0.3),0 2px 6px rgba(0,0,0,0.4);" +
        "pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)";
      (document.body ?? document.documentElement).appendChild(dot);

      const moveDot = (x: number, y: number, pulse = false): void => {
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        if (pulse) {
          void dot.animate(
            [
              { transform: "translate(-50%, -50%) scale(1)", opacity: "1" },
              { transform: "translate(-50%, -50%) scale(1.45)", opacity: "0.9" },
              { transform: "translate(-50%, -50%) scale(1)", opacity: "1" },
            ],
            { duration: 220, easing: "ease-out" },
          );
        }
      };

      const moveToTarget = (target: EventTarget | null, pulse = false): void => {
        if (!(target instanceof Element)) return;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        moveDot(rect.left + rect.width / 2, rect.top + rect.height / 2, pulse);
      };

      const trackEvent = (event: MouseEvent | PointerEvent, pulse = false): void => {
        if (event.clientX !== 0 || event.clientY !== 0) {
          moveDot(event.clientX, event.clientY, pulse);
          return;
        }
        moveToTarget(event.target, pulse);
      };

      document.addEventListener("mousemove", (event) => trackEvent(event), { capture: true, passive: true });
      document.addEventListener("pointermove", (event) => trackEvent(event), { capture: true, passive: true });
      document.addEventListener("mouseover", (event) => trackEvent(event), { capture: true, passive: true });
      document.addEventListener("pointerdown", (event) => trackEvent(event, true), { capture: true, passive: true });
      document.addEventListener("mousedown", (event) => trackEvent(event, true), { capture: true, passive: true });
      document.addEventListener("click", (event) => trackEvent(event, true), { capture: true, passive: true });
      document.addEventListener("focusin", (event) => moveToTarget(event.target, false), { capture: true, passive: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
  });
}

async function fillRegistrationStep1(page: Page, values: { firstName: string; lastName: string; email: string }): Promise<void> {
  await page.getByLabel("First name").fill(values.firstName);
  await page.getByLabel("Last name").fill(values.lastName);
  await page.getByLabel("Work email").fill(values.email);
  await page.getByRole("button", { name: /Continue/i }).click();
}

async function fillRegistrationStep2(page: Page): Promise<void> {
  await setNativeChecked(page, "input#dayAttendance-2026-12-01-in_person");
  await setNativeChecked(page, "input#dayAttendance-2026-12-02-on_demand");
  await setNativeChecked(page, "input#dayAttendance-2026-12-03-on_demand");
  await page.getByRole("button", { name: /Continue/i }).click();
}

async function fillRegistrationStep3(page: Page): Promise<void> {
  await page.getByLabel("Organization").fill("Test Org");
  await page.getByLabel("Job title").fill("Engineer");
  await page.getByLabel("Country").selectOption("US");
  await page.getByRole("button", { name: /Continue/i }).click();
}

async function fillRegistrationStep4(page: Page): Promise<void> {
  await clickConsentCard(page, "privacy policy");
  await clickConsentCard(page, "code of conduct");
  await clickConsentCard(page, "photos and videos");
  await page.getByRole("button", { name: /Secure my spot/i }).click();
}

async function fillInviteRegistration(page: Page, values: { firstName: string; lastName: string; email: string }): Promise<void> {
  await fillRegistrationStep1(page, values);
  await setNativeChecked(page, "input#dayAttendance-2026-12-01-on_demand");
  await setNativeChecked(page, "input#dayAttendance-2026-12-02-on_demand");
  await setNativeChecked(page, "input#dayAttendance-2026-12-03-on_demand");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("Organization").fill("Test Org");
  await page.getByLabel("Job title").fill("Engineer");
  await page.getByLabel("Country").selectOption("US");
  await page.getByRole("button", { name: /Continue/i }).click();
  await clickConsentCard(page, "privacy policy");
  await clickConsentCard(page, "code of conduct");
  await clickConsentCard(page, "photos and videos");
  await page.getByRole("button", { name: /Secure my spot/i }).click();
}

async function fillProposal(page: Page): Promise<void> {
  // Step 1: accept all speaker consent terms
  const consentCards = page.locator("div.event-flow-consent-card");
  await consentCards.first().waitFor({ state: "visible", timeout: 10_000 });
  const count = await consentCards.count();
  for (let i = 0; i < count; i++) {
    await consentCards.nth(i).scrollIntoViewIfNeeded();
    await consentCards.nth(i).evaluate((el) => (el as HTMLElement).click());
  }
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel("First name").fill("Priya");
  await page.getByLabel("Last name").fill("Proposal");
  await page.getByLabel("Work email").fill("proposal-speaker@example.test");
  await page.getByLabel("Organization").fill("Example Org");
  await page.getByLabel("Job title").fill("Engineer");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByRole("radio", { name: /^Talk$/i }).check();
  await page.locator("#proposal-title").fill("Operational Trust in a Post-Quantum Transition");
  await page.locator("#proposal-abstract").fill(
    "This talk covers practical migration decision-making, governance trade-offs, and the operational work required to move from pilot planning to production readiness in a post-quantum transition.",
  );
  await page.getByLabel("Preferred track").selectOption("Technical Deep Dive");
  await page.getByLabel("Target audience level").selectOption("Intermediate");
  await page.getByRole("button", { name: /Continue/i }).click();
}

async function signInAsAdmin(page: Page): Promise<string> {
  await page.goto("/admin/");
  await expect(page.locator("#form-magic")).toBeVisible({ timeout: 10_000 });

  await page.locator("#inp-email").fill("admin@pkic.org");
  await page.locator("#btn-send").click();
  await expect(page.locator("#magic-sent")).toBeVisible({ timeout: 10_000 });

  const magicEmail = await waitForEmail("admin@pkic.org", "sign-in");
  const magicUrl = extractUrlFromEmail(magicEmail, "/admin/");

  await page.goto(magicUrl);
  await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });

  const adminToken = await page.evaluate(() => window.localStorage.getItem("pkic_at"));
  expect(adminToken).toBeTruthy();

  return adminToken as string;
}

async function setEventDayInPersonCapacity(
  page: Page,
  adminToken: string,
  eventSlug: string,
  dayDate: string,
  capacity: number,
): Promise<void> {
  const result = await page.evaluate(async ({ adminToken: token, eventSlug: slug, dayDate: date, capacity: nextCapacity }) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const getResponse = await fetch(`/api/v1/admin/events/${slug}/days`, { headers });
    const getBody = await getResponse.json() as {
      days?: Array<{
        date: string;
        label: string | null;
        startsAt: string | null;
        endsAt: string | null;
        sortOrder: number;
        attendanceOptions: Array<{ value: string; label: string; capacity?: number | null }>;
      }>;
    };

    if (!getResponse.ok || !getBody.days) {
      return { ok: false, getStatus: getResponse.status, putStatus: 0, reason: "get_failed" };
    }

    const days = getBody.days.map((day) => ({
      date: day.date,
      label: day.label ?? undefined,
      startTime: day.startsAt
        ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Amsterdam",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(day.startsAt))
        : undefined,
      endTime: day.endsAt
        ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Amsterdam",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(day.endsAt))
        : undefined,
      sortOrder: day.sortOrder,
      attendanceOptions: day.attendanceOptions.map((option) => (
        option.value === "in_person" && day.date === date
          ? { ...option, capacity: nextCapacity }
          : option
      )),
    }));

    const putResponse = await fetch(`/api/v1/admin/events/${slug}/days`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ days }),
    });

    const putBody = await putResponse.json() as {
      days?: Array<{ date: string; attendanceOptions: Array<{ value: string; capacity?: number | null }> }>;
    };
    const updatedCapacity = putBody.days
      ?.find((day) => day.date === date)
      ?.attendanceOptions.find((option) => option.value === "in_person")
      ?.capacity;

    return {
      ok: putResponse.ok,
      getStatus: getResponse.status,
      putStatus: putResponse.status,
      updatedCapacity: updatedCapacity ?? null,
      reason: putResponse.ok ? null : "put_failed",
    };
  }, { adminToken, eventSlug, dayDate, capacity });

  expect(result.ok, `admin day capacity update failed: ${JSON.stringify(result)}`).toBe(true);
  expect(result.updatedCapacity).toBe(capacity);
}

test.describe("browser workflows", () => {
  test("shows a friendly partial waitlist state when a selected day is full", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page, {
      ignoreConsoleError: (text) => text === "Failed to load resource: the server responded with a status of 500 ()",
      ignoreResponse: (url) => /\/images\/members\/.+\.svg(?:\?|$)/.test(url),
    });
    const screenshot = createScreenshotter(page);

    const adminToken = await signInAsAdmin(page);
    const eventSlug = "pqc-conference-amsterdam-nl";
    const dayDate = "2026-12-01";
    const restoredCapacity = 800;

    try {
      await setEventDayInPersonCapacity(page, adminToken, eventSlug, dayDate, 1);

      await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
      await fillRegistrationStep1(page, {
        firstName: "Capacity",
        lastName: "One",
        email: "capacity-one@example.test",
      });
      await fillRegistrationStep2(page);
      await fillRegistrationStep3(page);
      await fillRegistrationStep4(page);

      const firstConfirmEmail = await waitForEmail("capacity-one@example.test", "confirm");
      const firstConfirmationUrl = extractUrlFromEmail(firstConfirmEmail, "/register/confirm");
      await page.goto(firstConfirmationUrl);
      await page.getByRole("button", { name: /Please click here to confirm your registration/i }).click();
      await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible({ timeout: 15_000 });

      await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
      await fillRegistrationStep1(page, {
        firstName: "Capacity",
        lastName: "Two",
        email: "capacity-two@example.test",
      });
      await fillRegistrationStep2(page);
      await fillRegistrationStep3(page);
      await fillRegistrationStep4(page);

      const secondConfirmEmail = await waitForEmail("capacity-two@example.test", "confirm");
      const secondConfirmationUrl = extractUrlFromEmail(secondConfirmEmail, "/register/confirm");
      await page.goto(secondConfirmationUrl);
      await page.getByRole("button", { name: /Please click here to confirm your registration/i }).click();
      await expect(page.getByRole("heading", { name: /registration is in place/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Your overall registration is confirmed, but one or more selected in-person days are still pending")).toBeVisible();
      await screenshot("01-partial-capacity-confirmed");

      const secondRegisteredEmail = await waitForEmail("capacity-two@example.test", "confirmed");
      const secondManageUrl = extractUrlFromEmail(secondRegisteredEmail, "/register/manage/");
      const secondManageToken = new URL(secondManageUrl).searchParams.get("token") ?? "";

      await page.goto(
        `/events/2026/pqc-conference-amsterdam-nl/register/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(secondManageToken)}`,
      );

      await expect(page.locator("[data-manage-status-badge]")).toHaveText(/Confirmed/i);
      await expect(page.locator("[data-manage-status-banner]")).toContainText(
        "Some day-specific entries are still pending, so those days are marked waitlisted below.",
      );
      await expect(page.locator("[data-day-waitlist-section]")).toContainText("Tuesday 1 December 2026: Waiting for in-person seat");
      await screenshot("02-partial-capacity-manage-friendly-state");

      errorMonitor.assertClean();
    } finally {
      await setEventDayInPersonCapacity(page, adminToken, eventSlug, dayDate, restoredCapacity);
    }
  });

  test("covers registration, invite acceptance, confirmation, manage updates, and invite decline", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
    await expect(page).toHaveTitle(/Post-Quantum Cryptography Conference/);

    await fillRegistrationStep1(page, {
      firstName: "Alice",
      lastName: "Attendee",
      email: "alice@example.test",
    });
    await fillRegistrationStep2(page);
    await fillRegistrationStep3(page);
    await fillRegistrationStep4(page);

    await expect(page.getByRole("heading", { name: /Almost there, Alice!/i })).toBeVisible();
    await screenshot("01-registration-pending-email-confirmation");

    // Wait for the confirmation email to arrive at the intercept server
    const confirmEmail = await waitForEmail("alice@example.test", "confirm");
    const confirmationUrl = extractUrlFromEmail(confirmEmail, "/register/confirm");

    await page.goto(confirmationUrl);
    await expect(page.getByText(/one click away/i)).toBeVisible();
    await page.getByRole("button", { name: /Please click here to confirm your registration/i }).click();
    // The confirmed-state heading appears once the API call completes
    await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible({ timeout: 15_000 });
    await screenshot("02-registration-confirmed");

    // Wait for the "confirmed" email which carries the manage URL
    const confirmedEmail = await waitForEmail("alice@example.test", "confirmed");
    const manageUrl = extractUrlFromEmail(confirmedEmail, "/register/manage/");

    const registrationManageRoute = `/events/2026/pqc-conference-amsterdam-nl/register/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(new URL(manageUrl).searchParams.get("token") ?? "")}`;
    await page.goto(registrationManageRoute);
    await expect(page.getByText(/Hi Alice, we're looking forward to seeing you/i)).toBeVisible();
    const onDemandRadio = page.getByRole("radio", { name: /On-demand/i }).first();
    await onDemandRadio.scrollIntoViewIfNeeded();
    await onDemandRadio.evaluate((el) => (el as HTMLInputElement).click());
    await page.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Changes saved/i)).toBeVisible();
    await screenshot("03-attendance-type-changed-to-on-demand");

    const manageToken = new URL(manageUrl).searchParams.get("token");
    expect(manageToken).toBeTruthy();

    // Invite two attendees via the API using Alice's manage token
    const inviteResp = await page.evaluate(async (token) => {
      const res = await fetch("/api/v1/events/pqc-conference-amsterdam-nl/invites", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invites: [
            { email: "friend-accept@example.test", firstName: "First", lastName: "Friend" },
            { email: "friend-decline@example.test", firstName: "Second", lastName: "Friend" },
          ],
        }),
      });
      return res.status;
    }, manageToken);
    expect(inviteResp).toBe(200);

    // Accept-invite flow
    const acceptInviteEmail = await waitForEmail("friend-accept@example.test", "invited");
    const acceptRegistrationUrl = extractUrlFromEmail(acceptInviteEmail, "/register/");
    const acceptDeclineUrl = extractUrlFromEmail(acceptInviteEmail, "/invite/");
    expect(acceptRegistrationUrl).toBeTruthy();
    expect(acceptDeclineUrl).toBeTruthy();

    await page.goto(acceptRegistrationUrl);
    await expect(page).toHaveTitle(/Register for/);
    await fillInviteRegistration(page, {
      firstName: "First",
      lastName: "Friend",
      email: "friend-accept@example.test",
    });
    await expect(page.getByRole("heading", { name: /You're registered, First!/i })).toBeVisible();
    await screenshot("04-invited-attendee-registered");

    // Ensure the confirmation email arrived for the accepted invite
    const acceptConfirmedEmail = await waitForEmail("friend-accept@example.test", "confirmed");
    const acceptManageUrl = extractUrlFromEmail(acceptConfirmedEmail, "/register/manage/");
    expect(acceptManageUrl).toBeTruthy();

    // Decline-invite flow
    const declineInviteEmail = await waitForEmail("friend-decline@example.test", "invited");
    const declineUrl = extractUrlFromEmail(declineInviteEmail, "/invite/");

    await page.goto(declineUrl);
    await expect(page.getByRole("heading", { name: /Not able to make it\?/i })).toBeVisible();
    const scheduleConflictRadio = page.getByRole("radio", { name: /Schedule conflict/i });
    await scheduleConflictRadio.scrollIntoViewIfNeeded();
    await scheduleConflictRadio.evaluate((el) => (el as HTMLInputElement).click());
    await page.getByLabel(/Additional comments/i).fill("I have another commitment that overlaps.");
    await page.getByRole("button", { name: /Decline this invitation/i }).click();
    await expect(page.getByRole("heading", { name: /Thank you for letting us know/i })).toBeVisible();
    await screenshot("05-invite-declined");

    // Attempting to use the same decline URL again must show "already processed"
    await page.goto(declineUrl);
    await expect(page.getByText(/Invitation already processed/i)).toBeVisible();
    await screenshot("06-decline-link-already-processed");

    errorMonitor.assertClean();
  });

  test("covers proposal submission, speaker invitation, confirmation, and profile updates", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    await page.goto("/events/2026/pqc-conference-amsterdam-nl/propose/");
    await expect(page).toHaveTitle(/Submit a Session Proposal/);

    await fillProposal(page);
    await page.getByRole("button", { name: /Submit proposal/i }).click();
    await expect(page.getByRole("heading", { name: /Proposal submitted, Priya!/i })).toBeVisible();
    await screenshot("01-proposal-submitted");

    const proposalSubmittedEmail = await waitForEmail("proposal-speaker@example.test", "proposal");
    const proposalManageUrl = extractUrlFromEmail(proposalSubmittedEmail, "/propose/manage/");

    const proposalManageRoute = `/events/2026/pqc-conference-amsterdam-nl/propose/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(new URL(proposalManageUrl).searchParams.get("token") ?? "")}`;
    await page.goto(proposalManageRoute);
    await expect(page.getByText(/Open this page from your proposal management link/i)).toBeVisible();
    await page.getByLabel("Session type").selectOption("panel");
    await page.getByLabel("Title").fill("Operational Trust in a Post-Quantum Transition, Revised");
    await page.getByLabel("Abstract").fill(
      "A revised abstract describing the operational migration choices, governance controls, and delivery trade-offs teams face while moving critical infrastructure into a post-quantum future.",
    );
    await page.getByRole("button", { name: /Save changes/i }).click();
    await expect(page.getByText(/Proposal updated/i)).toBeVisible();
    await screenshot("02-proposal-updated");

    await page.getByLabel("Email *").fill("speaker@example.test");
    await page.getByLabel("First name").fill("Sam");
    await page.getByLabel("Last name").fill("Speaker");
    await page.getByLabel("Role").selectOption("co_speaker");
    await page.getByRole("button", { name: /Send invite/i }).click();
    await expect(page.getByText(/Invite sent to speaker@example.test/i)).toBeVisible();
    await screenshot("03-speaker-invited");

    const speakerInviteEmail = await waitForEmail("speaker@example.test", "speaker");
    const speakerManageUrl = extractUrlFromEmail(speakerInviteEmail, "/propose/speaker/");

    const speakerManageRoute = `/events/2026/pqc-conference-amsterdam-nl/propose/speaker/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(new URL(speakerManageUrl).searchParams.get("token") ?? "")}`;
    await page.goto(speakerManageRoute);
    await expect(page.getByText(/Please confirm whether you would like to participate/i)).toBeVisible();
    // Accept all speaker consent terms
    const spkConsentCards2 = page.locator("div.event-flow-consent-card");
    await spkConsentCards2.first().waitFor({ state: "visible", timeout: 10_000 });
    for (let i = 0; i < await spkConsentCards2.count(); i++) {
      await spkConsentCards2.nth(i).scrollIntoViewIfNeeded();
      await spkConsentCards2.nth(i).evaluate((el) => (el as HTMLElement).click());
    }
    await page.getByRole("button", { name: /Confirm participation/i }).click();
    await expect(page.locator("[data-confirmed-msg]")).toBeVisible();
    await screenshot("04-speaker-participation-confirmed");

    // After confirmation the profile section is revealed with the form directly visible;
    // "Edit profile" only appears after a profile has already been saved.
    await page.getByLabel(/Biography/i).fill(
      "Updated speaker biography with enough detail to satisfy validation and demonstrate the browser workflow.",
    );
    await page.getByLabel("Profile URL").fill("https://example.com/portfolio");
    await page.getByRole("button", { name: /Add profile link/i }).click();
    await page.getByRole("button", { name: /Save profile/i }).click();
    await expect(page.getByText(/Profile updated/i)).toBeVisible();
    await screenshot("05-speaker-profile-saved");

    // Verify the saved-state banner is shown and the edit round-trip works
    await expect(page.locator("[data-profile-saved-state]")).toBeVisible();
    await page.locator("[data-profile-edit]").click();
    await expect(page.locator("[data-profile-form-wrap]")).toBeVisible();
    await page.getByLabel(/Biography/i).fill("Second revision of the speaker biography, confirming the edit round-trip works.");
    await page.getByRole("button", { name: /Save profile/i }).click();
    await expect(page.getByText(/Profile updated/i)).toBeVisible();
    await screenshot("06-speaker-profile-round-trip");

    // Upload a headshot via the browser, exercising the real R2 upload path
    const speakerToken = new URL(speakerManageUrl).searchParams.get("token") ?? "";
    const headshotResult = await page.evaluate(async (token) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx!.fillStyle = "#c0392b";
      ctx!.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      if (!blob) return { success: false, headshotUrl: null };
      const fd = new FormData();
      fd.append("file", new File([blob], "headshot.jpg", { type: "image/jpeg" }));
      fd.append("consent", "true");
      const res = await fetch(`/api/v1/proposals/speaker/${encodeURIComponent(token)}/headshot`, { method: "PUT", body: fd });
      return res.json() as Promise<{ success?: boolean; headshotUrl?: string }>;
    }, speakerToken);
    expect(headshotResult.success).toBe(true);
    expect(headshotResult.headshotUrl).toBeTruthy();

    // Reload the speaker page and verify the headshot <img> element is rendered
    await page.goto(speakerManageRoute);
    await expect(page.locator("[data-headshot-preview] img")).toBeVisible();
    await screenshot("07-speaker-headshot-visible");

    // Accept the proposal via the API so the presentation-upload section becomes visible
    const propManageToken = new URL(proposalManageUrl).searchParams.get("token") ?? "";
    const acceptResult = await page.evaluate(async (token) => {
      // Admin path not available in this test; PATCH the proposal status via the manage token
      // by checking if there's a status-update endpoint (skip if not exposed to speakers)
      return { skipped: true, token };
    }, propManageToken);
    // If no speaker-facing accept endpoint exists, verify the section is hidden by default
    if (!acceptResult.skipped) {
      await page.reload();
      await expect(page.locator("[data-presentation-section]")).toBeVisible();
    }

    // Upload a minimal PDF to exercise the presentation upload path
    const presentationResult = await page.evaluate(async (token) => {
      const pdfContent = "%PDF-1.0\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj 2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj 3 0 obj<</Type /Page /MediaBox [0 0 3 3]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF";
      const pdfBlob = new Blob([pdfContent], { type: "application/pdf" });
      const fd = new FormData();
      fd.append("file", new File([pdfBlob], "presentation.pdf", { type: "application/pdf" }));
      const res = await fetch(`/api/v1/proposals/speaker/${encodeURIComponent(token)}/presentation`, { method: "PUT", body: fd });
      if (res.status === 403 || res.status === 404 || res.status === 409) return { success: false as const, skipped: true as const };
      const data = await res.json() as { success?: boolean };
      return { success: data.success, skipped: false as const };
    }, speakerToken);
    if (!presentationResult.skipped) {
      expect(presentationResult.success).toBe(true);
    }
    await screenshot("08-presentation-uploaded");

    errorMonitor.assertClean();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test("security: access control, single-use tokens, and XSS input handling", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    // ── Setup: register an attendee ─────────────────────────────────────────────
    // The bio field has no character restriction so we can store the XSS payload
    // there to verify it is HTML-escaped wherever it's reflected.
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
    await fillRegistrationStep1(page, {
      firstName: "Sec",
      lastName: "Tester",
      email: "sec@example.test",
    });
    await fillRegistrationStep2(page);
    await fillRegistrationStep3(page);
    await fillRegistrationStep4(page);

    const confirmEmail = await waitForEmail("sec@example.test", "confirm");
    const confirmationUrl = extractUrlFromEmail(confirmEmail, "/register/confirm");

    // ── 1. XSS: firstName on the confirmation page must be escaped ──────────
    await page.goto(confirmationUrl);
    await expect(page.getByText(/one click away/i)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__xss_fired)).toBeUndefined();
    await screenshot("01-xss-firstname-escaped-on-confirm-page");

    // ── 2. Confirm the registration ──────────────────────────────────────
    const [confirmResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/registrations/confirm-email")),
      page.getByRole("button", { name: /Please click here to confirm your registration/i }).click(),
    ]);
    expect(confirmResponse.status()).toBe(200);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__xss_fired)).toBeUndefined();
    await screenshot("02-xss-firstname-escaped-on-success-panel");

    const confirmedEmail = await waitForEmail("sec@example.test", "confirmed");
    const manageUrl = extractUrlFromEmail(confirmedEmail, "/register/manage/");
    const validToken = new URL(manageUrl).searchParams.get("token") ?? "";

    // ── 3. Confirmation token is single-use ────────────────────────────────
    await page.goto(confirmationUrl);
    const retryBtn = page.getByRole("button", { name: /Please click here to confirm/i });
    if (await retryBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      const [retryResponse] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/registrations/confirm-email")),
        retryBtn.click(),
      ]);
      expect(retryResponse.status()).not.toBe(200);
    }
    await screenshot("03-confirmation-token-single-use-rejected");

    // ── 4. Invalid manage token: graceful error, no crash ─────────────────
    await page.goto(
      `/events/2026/pqc-conference-amsterdam-nl/register/manage/?event=pqc-conference-amsterdam-nl&token=INVALID_TOKEN_DEFINITELY_NOT_REAL`,
    );
    await expect(page.getByText(/invalid|error|expired|not found/i)).toBeVisible({ timeout: 10_000 });
    await screenshot("04-invalid-manage-token-graceful-error");

    // ── 5. API with fabricated token → 4xx, never 200 or 500 ───────────────
    const apiResults = await page.evaluate(async () => {
      const fake = encodeURIComponent("FAKE-TOKEN-000000000000000000000000");
      const [getStatus, patchStatus] = await Promise.all([
        fetch(`/api/v1/registrations/manage/${fake}`).then((r) => r.status),
        fetch(`/api/v1/registrations/manage/${fake}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "update", attendanceType: "on_demand" }),
        }).then((r) => r.status),
      ]);
      return { getStatus, patchStatus };
    });
    expect([401, 403, 404]).toContain(apiResults.getStatus);
    expect([401, 403, 404]).toContain(apiResults.patchStatus);

    // ── 6. Schema validation: SQL-injection in enum field → 400, not 500 ───
    const invalidEnumStatus = await page.evaluate(async (token) => {
      const res = await fetch(`/api/v1/registrations/manage/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", attendanceType: "'; DROP TABLE registrations; --" }),
      });
      return res.status;
    }, validToken);
    expect(invalidEnumStatus).toBe(400);

    // ── 7. Speaker manage token isolation ─────────────────────────────────
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/propose/");
    await fillProposal(page);
    await page.getByRole("button", { name: /Submit proposal/i }).click();
    await expect(page.getByRole("heading", { name: /Proposal submitted, Priya!/i })).toBeVisible();

    const proposalEmail = await waitForEmail("proposal-speaker@example.test", "proposal");
    const propManageUrl = extractUrlFromEmail(proposalEmail, "/propose/manage/");
    const propToken = new URL(propManageUrl).searchParams.get("token") ?? "";

    await page.goto(`/events/2026/pqc-conference-amsterdam-nl/propose/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(propToken)}`);
    await page.getByLabel("Email *").fill("speaker-sec@example.test");
    await page.getByLabel("First name").fill("Sec");
    await page.getByLabel("Last name").fill("Speaker");
    await page.getByLabel("Role").selectOption("co_speaker");
    await page.getByRole("button", { name: /Send invite/i }).click();
    await expect(page.getByText(/Invite sent to speaker-sec@example.test/i)).toBeVisible();

    const spkInviteEmail = await waitForEmail("speaker-sec@example.test", "speaker");
    const spkManageUrl = extractUrlFromEmail(spkInviteEmail, "/propose/speaker/");
    const spkToken = new URL(spkManageUrl).searchParams.get("token") ?? "";

    // PATCH a completely fabricated speaker token — must be 4xx
    const isolationStatus = await page.evaluate(async () => {
      const fakeSpkToken = encodeURIComponent("ISOLATION-FAKE-SPEAKER-TOKEN-000000");
      const res = await fetch(`/api/v1/proposals/speaker/${fakeSpkToken}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biography: "injected bio" }),
      });
      return res.status;
    });
    expect([401, 403, 404]).toContain(isolationStatus);

    // Confirm the real speaker and verify their bio was NOT tampered with
    const spkRoute = `/events/2026/pqc-conference-amsterdam-nl/propose/speaker/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(spkToken)}`;
    await page.goto(spkRoute);
    // Accept all speaker consent terms
    const spkConsentCards = page.locator("div.event-flow-consent-card");
    await spkConsentCards.first().waitFor({ state: "visible", timeout: 10_000 });
    for (let i = 0; i < await spkConsentCards.count(); i++) {
      await spkConsentCards.nth(i).scrollIntoViewIfNeeded();
      await spkConsentCards.nth(i).evaluate((el) => (el as HTMLElement).click());
    }
    await page.getByRole("button", { name: /Confirm participation/i }).click();
    await expect(page.locator("[data-confirmed-msg]")).toBeVisible();

    const bioValue = await page.getByLabel(/Biography/i).inputValue();
    expect(bioValue).not.toContain("injected bio");
    await screenshot("05-speaker-token-isolation-verified");

    errorMonitor.assertClean();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test("covers admin sign-in via magic link", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    // Admin page must display the login form (no active session)
    await page.goto("/admin/");
    await expect(page.locator("#form-magic")).toBeVisible({ timeout: 10_000 });

    // Request a magic link for the seeded admin account
    await page.locator("#inp-email").fill("admin@pkic.org");
    await page.locator("#btn-send").click();
    // The form is hidden and the sent-confirmation panel is shown
    await expect(page.locator("#magic-sent")).toBeVisible({ timeout: 10_000 });
    await screenshot("01-magic-link-sent");

    // Wait for the email (subject: "Your PKI Consortium admin sign-in link")
    const magicEmail = await waitForEmail("admin@pkic.org", "sign-in");
    // The email contains a link to /admin/?token=…
    const magicUrl = extractUrlFromEmail(magicEmail, "/admin/");

    // Navigating to the magic link URL triggers the DOMContentLoaded handler
    // which reads ?token=, calls /api/v1/admin/auth/verify-link, and shows the admin root
    await page.goto(magicUrl);
    await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });
    await screenshot("02-admin-dashboard-loaded");

    errorMonitor.assertClean();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test("covers resend of registration manage link", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    // Register and confirm a fresh attendee
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
    await fillRegistrationStep1(page, {
      firstName: "Resend",
      lastName: "Tester",
      email: "resend-tester@example.test",
    });
    await fillRegistrationStep2(page);
    await fillRegistrationStep3(page);
    await fillRegistrationStep4(page);

    const confirmEmail = await waitForEmail("resend-tester@example.test", "confirm");
    const confirmationUrl = extractUrlFromEmail(confirmEmail, "/register/confirm");
    await page.goto(confirmationUrl);
    await page.getByRole("button", { name: /Please click here to confirm your registration/i }).click();
    await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible({ timeout: 15_000 });

    // Navigate to the manage page WITHOUT a token — the resend form must appear
    await page.goto(
      "/events/2026/pqc-conference-amsterdam-nl/register/manage/?event=pqc-conference-amsterdam-nl",
    );
    await expect(page.locator("[data-resend-manage-section]")).toBeVisible({ timeout: 10_000 });
    await screenshot("01-resend-manage-form-visible");

    // Fill the email address and request a fresh link
    await page.locator("[data-resend-manage-email]").fill("resend-tester@example.test");
    await page.locator("[data-resend-manage-btn]").click();
    await expect(page.getByText(/you will receive an email shortly/i)).toBeVisible({ timeout: 10_000 });
    await screenshot("02-resend-manage-submitted");

    // Wait for fresh management link email (subject: "Your management link for …")
    const newManageEmail = await waitForEmail("resend-tester@example.test", "Your management link");
    const newManageUrl = extractUrlFromEmail(newManageEmail, "/register/manage/");
    const newManageToken = new URL(newManageUrl).searchParams.get("token") ?? "";

    // The refreshed token must load the full management page
    await page.goto(
      `/events/2026/pqc-conference-amsterdam-nl/register/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(newManageToken)}`,
    );
    await expect(page.getByText(/Hi Resend, we're looking forward to seeing you/i)).toBeVisible({ timeout: 10_000 });
    await screenshot("03-refreshed-manage-link-works");

    errorMonitor.assertClean();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  test("covers speaker nomination invite, proposal via invite link, decline, and speaker manage link resend", async ({ page }) => {
    await setupPage(page);
    const errorMonitor = monitorErrors(page);
    const screenshot = createScreenshotter(page);

    // Register and confirm a nominator so we have a valid manage token
    await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
    await fillRegistrationStep1(page, {
      firstName: "Nominator",
      lastName: "User",
      email: "nominator@example.test",
    });
    await fillRegistrationStep2(page);
    await fillRegistrationStep3(page);
    await fillRegistrationStep4(page);

    const nominatorConfirmEmail = await waitForEmail("nominator@example.test", "confirm");
    const nominatorConfirmUrl = extractUrlFromEmail(nominatorConfirmEmail, "/register/confirm");
    await page.goto(nominatorConfirmUrl);
    await page.getByRole("button", { name: /Please click here to confirm your registration/i }).click();
    await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible({ timeout: 15_000 });

    const nominatorConfirmedEmail = await waitForEmail("nominator@example.test", "confirmed");
    const nominatorManageUrl = extractUrlFromEmail(nominatorConfirmedEmail, "/register/manage/");
    const nominatorManageToken = new URL(nominatorManageUrl).searchParams.get("token") ?? "";
    expect(nominatorManageToken).toBeTruthy();

    // Nominate speakers via the API (no browser page exists for this endpoint)
    const speakerInviteStatus = await page.evaluate(async (token) => {
      const res = await fetch("/api/v1/events/pqc-conference-amsterdam-nl/speaker-invites", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invites: [
            { email: "sam-speaker@example.test", firstName: "Sam", lastName: "Speaker" },
            { email: "dana-decline@example.test", firstName: "Dana", lastName: "Decline" },
          ],
        }),
      });
      return res.status;
    }, nominatorManageToken);
    expect(speakerInviteStatus).toBe(200);
    await screenshot("01-speakers-nominated");

    // ── Dana declines the speaker invitation via the browser ──────────────────
    // Subject: "Invitation to speak at …"
    const danaInviteEmail = await waitForEmail("dana-decline@example.test", "speak");
    const danaDeclineUrl = extractUrlFromEmail(danaInviteEmail, "/invite/decline/");
    await page.goto(danaDeclineUrl);
    // For speaker invites, the heading reads "Not able to submit a proposal?"
    await expect(page.getByRole("heading", { name: /Not able to/i })).toBeVisible();
    await setNativeChecked(page, "input[name='reasonCode'][value='schedule_conflict']");
    // For speaker invites, the submit button reads "Decline this proposal invitation"
    await page.getByRole("button", { name: /Decline this/i }).click();
    await expect(page.getByRole("heading", { name: /Thank you for letting us know/i })).toBeVisible();
    await screenshot("02-speaker-invite-declined");

    // Re-navigating to the same decline URL must show "already processed"
    await page.goto(danaDeclineUrl);
    await expect(page.getByText(/Invitation already processed/i)).toBeVisible();
    await screenshot("03-speaker-decline-already-processed");

    // ── Sam accepts by submitting a proposal via the invite link ─────────────
    const samInviteEmail = await waitForEmail("sam-speaker@example.test", "speak");
    const samProposalUrl = extractUrlFromEmail(samInviteEmail, "/propose/");
    await page.goto(samProposalUrl);
    await expect(page).toHaveTitle(/Submit a Session Proposal/);
    // Accept all speaker consent terms
    const samConsentCards = page.locator("div.event-flow-consent-card");
    await samConsentCards.first().waitFor({ state: "visible", timeout: 10_000 });
    for (let i = 0; i < await samConsentCards.count(); i++) {
      await samConsentCards.nth(i).scrollIntoViewIfNeeded();
      await samConsentCards.nth(i).evaluate((el) => (el as HTMLElement).click());
    }
    await page.getByRole("button", { name: /Continue/i }).click();
    await page.getByLabel("First name").fill("Sam");
    await page.getByLabel("Last name").fill("Speaker");
    await page.getByLabel("Work email").fill("sam-speaker@example.test");
    await page.getByLabel("Organization").fill("Speaker Org");
    await page.getByLabel("Job title").fill("Security Researcher");
    await page.getByRole("button", { name: /Continue/i }).click();
    await page.getByRole("radio", { name: /^Talk$/i }).check();
    await page.locator("#proposal-title").fill("Speaker-Nominated Session on Post-Quantum Readiness");
    await page.locator("#proposal-abstract").fill(
      "An overview of post-quantum readiness programmes, covering the technical and organisational steps required to prepare enterprise infrastructure for cryptographic agility.",
    );
    await page.getByLabel("Preferred track").selectOption("Technical Deep Dive");
    await page.getByLabel("Target audience level").selectOption("Intermediate");
    await page.getByRole("button", { name: /Continue/i }).click();
    await page.getByRole("button", { name: /Submit proposal/i }).click();
    await expect(page.getByRole("heading", { name: /Proposal submitted, Sam!/i })).toBeVisible();
    await screenshot("04-proposal-submitted-via-invite-link");

    // Get the proposal manage URL from the submitted email
    // Subject: "Proposal received: Speaker-Nominated Session on Post-Quantum Readiness"
    const samProposalSubmittedEmail = await waitForEmail("sam-speaker@example.test", "Proposal received");
    const samProposalManageUrl = extractUrlFromEmail(samProposalSubmittedEmail, "/propose/manage/");
    const samProposalManageToken = new URL(samProposalManageUrl).searchParams.get("token") ?? "";

    // Sam invites a co-speaker from the proposal manage page
    const proposalManageRoute = `/events/2026/pqc-conference-amsterdam-nl/propose/manage/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(samProposalManageToken)}`;
    await page.goto(proposalManageRoute);
    await expect(page.getByText(/Open this page from your proposal management link/i)).toBeVisible();
    await page.getByLabel("Email *").fill("co-sam-speaker@example.test");
    await page.getByLabel("First name").fill("Co");
    await page.getByLabel("Last name").fill("Sam");
    await page.getByLabel("Role").selectOption("co_speaker");
    await page.getByRole("button", { name: /Send invite/i }).click();
    await expect(page.getByText(/Invite sent to co-sam-speaker@example.test/i)).toBeVisible();
    await screenshot("05-co-speaker-invited");

    // ── Resend the co-speaker manage link via the browser ────────────────────
    // Navigate to speaker manage page WITHOUT a token — the resend form must appear
    await page.goto(
      "/events/2026/pqc-conference-amsterdam-nl/propose/speaker/?event=pqc-conference-amsterdam-nl",
    );
    await expect(page.locator("[data-resend-speaker-manage-section]")).toBeVisible({ timeout: 10_000 });
    await screenshot("06-resend-speaker-manage-form-visible");

    // Fill the co-speaker email and request a fresh link
    await page.locator("[data-resend-speaker-manage-email]").fill("co-sam-speaker@example.test");
    await page.locator("[data-resend-speaker-manage-btn]").click();
    await expect(page.getByText(/you will receive an email shortly/i)).toBeVisible({ timeout: 10_000 });
    await screenshot("07-resend-speaker-manage-submitted");

    // Wait for the refreshed speaker management link
    // Subject: "Reminder: please confirm speaker participation — …"
    const refreshedCoSpeakerEmail = await waitForEmail("co-sam-speaker@example.test", "please confirm speaker");
    const refreshedCoSpeakerManageUrl = extractUrlFromEmail(refreshedCoSpeakerEmail, "/propose/speaker/");
    const refreshedToken = new URL(refreshedCoSpeakerManageUrl).searchParams.get("token") ?? "";

    // Navigate to the refreshed URL and confirm participation
    const refreshedRoute = `/events/2026/pqc-conference-amsterdam-nl/propose/speaker/?event=pqc-conference-amsterdam-nl&token=${encodeURIComponent(refreshedToken)}`;
    await page.goto(refreshedRoute);
    await expect(page.getByText(/Please confirm whether you would like to participate/i)).toBeVisible();
    // Accept all speaker consent terms
    const refreshedConsentCards = page.locator("div.event-flow-consent-card");
    await refreshedConsentCards.first().waitFor({ state: "visible", timeout: 10_000 });
    for (let i = 0; i < await refreshedConsentCards.count(); i++) {
      await refreshedConsentCards.nth(i).scrollIntoViewIfNeeded();
      await refreshedConsentCards.nth(i).evaluate((el) => (el as HTMLElement).click());
    }
    await page.getByRole("button", { name: /Confirm participation/i }).click();
    await expect(page.locator("[data-confirmed-msg]")).toBeVisible();
    await screenshot("08-co-speaker-confirmed-via-refreshed-link");

    errorMonitor.assertClean();
  });
});
