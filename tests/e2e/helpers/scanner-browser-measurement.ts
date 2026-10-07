import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { expect, type Page, type BrowserContext, type Route } from "@playwright/test";
import { agendaRevisionSchema, agendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
  registrationManageReadResponseSchema,
} from "../../../assets/shared/schemas/registration";
import {
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../../assets/shared/schemas/route-contracts-event-badges";
import { enrolledOfflineEligibilityResponseSchema } from "../../../assets/shared/schemas/event-offline-eligibility";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../../../assets/shared/schemas/event-participation-scanning";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { registerInBrowser } from "./registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { signInAsE2eStaff } from "./staff-auth";
import { e2eAdminEmail } from "../../helpers/e2e-admin";
import { scannerStorage, openScannerDiagnostics, closeScannerDiagnostics } from "./scanner-recovery-storage";

export const measurementSlug = "pqc-conference-amsterdam-nl";
export const measurementApi = `/api/v1/events/${measurementSlug}`;
export const measurementScanner = `/portal/#/events/${measurementSlug}/scanner`;
type Scan = ReturnType<typeof enrolledEventScanRequestSchema.parse>;
type Receipt = ReturnType<typeof eventScanResponseSchema.parse>;
export type FeedbackSample = { kind: "eligible" | "revoked" | "unknown" | "malformed"; elapsedMs: number };

/** Fixture construction is outside the measured window; every transition uses the mounted API/mailbox. */
export async function prepareScannerMeasurement(page: Page) {
  const template = await registerInBrowser(page, `measurement-template-${randomUUID()}@example.test`);
  const email = `measurement-physical-${randomUUID()}@example.test`;
  const malformed = `not-a-credential-${randomUUID()}`;
  const since = await capturedEmailCount();
  const registered = await page.request.post(`${measurementApi}/registrations`, {
    data: registrationCreateSchema.parse({
      ...template.request,
      email,
      attendanceType: "in_person",
      dayAttendance: template.request.dayAttendance?.map((day) => ({ ...day, attendanceType: "in_person" })),
    }),
  });
  expect(registered.status()).toBe(200);
  const registration = registrationSubmissionResponseSchema.parse(await registered.json());
  if (!registration.manageToken) throw new Error("Fresh attendee must receive its registration management capability");
  const mail = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(mail, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(email, "registration is confirmed", { since });
  const operatorEmail = e2eAdminEmail("scanner-recovery-owner");
  await signInAsE2eStaff(page, operatorEmail);
  const session = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const draft = agendaSnapshotSchema.parse(await (await page.request.get(`${measurementApi}/agenda`)).json());
  expect(draft.occurrences).toHaveLength(0);
  expect(draft.publishedRevision).toBeNull();
  const published = await page.request.post(`${measurementApi}/agenda/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: draft.revision }),
  });
  expect(published.status()).toBe(200);
  const agenda = agendaSnapshotSchema.parse(await published.json());
  expect(agenda.publishedRevision).toBe(agenda.revision);
  const attendees = badgeAttendeesResponseSchema.parse(
    await (
      await page.request.get(
        `${measurementApi}/badges/attendees?q=${encodeURIComponent(email)}&sort=email&limit=10&offset=0`,
      )
    ).json(),
  );
  const attendee = attendees.users.find((row) => row.email === email);
  if (!attendee) throw new Error("Verified physical attendee is unavailable for badge issuance");
  const badges = [];
  for (let index = 0; index < 2; index++) {
    const issued = await page.request.post(`${measurementApi}/badges`, {
      data: badgeIssueRequestSchema.parse({ operationId: randomUUID(), userId: attendee.id }),
    });
    expect(issued.status()).toBe(200);
    const badge = badgeIssueResponseSchema.parse(await issued.json());
    if (badge.result !== "issued") throw new Error("Fresh measurement badge must return its one-time credential");
    badges.push(badge);
  }
  const [eligible, revoked] = badges;
  if (!eligible || !revoked) throw new Error("Measurement needs independent active and revoked credentials");
  expect((await page.request.delete(`${measurementApi}/badges/${revoked.id}`)).status()).toBe(200);
  const managePath = `/api/v1/registrations/access/${encodeURIComponent(registration.manageToken)}`;
  const manageResponse = await page.request.get(managePath);
  expect(manageResponse.status()).toBe(200);
  expect(manageResponse.headers()["content-type"]).toContain("application/json");
  const registrationBefore = registrationManageReadResponseSchema.parse(await manageResponse.json());
  return {
    operatorEmail,
    operatorId: session.identity.id,
    attendeeId: attendee.id,
    eligible: eligible.credential,
    eligibleBadgeId: eligible.id,
    revoked: revoked.credential,
    unknown: randomUUID(),
    publishedRevision: agenda.revision,
    malformed,
    forbidden: [email, malformed],
    managePath,
    registrationBefore,
  };
}

/** The actual browser must lack Background Sync; no property deletion or injected replacement is used. */
export async function openMeasurementScanner(page: Page, publishedRevision: number) {
  const preparing = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${measurementApi}/offline-eligibility` && response.ok(),
  );
  await page.goto(measurementScanner);
  const manifest = enrolledOfflineEligibilityResponseSchema.parse(await (await preparing).json());
  expect(manifest.publishedRevision).toBe(publishedRevision);
  await openScannerDiagnostics(page);
  await expect(
    page.getByText("Eligibility data ready. Checks run locally; attendance uploads in the background.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).not.toBe("");
  const capabilities = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      syncManager: "SyncManager" in window,
      registrationSync: "sync" in registration,
      userAgent: navigator.userAgent,
      worker: registration.active?.scriptURL ?? null,
    };
  });
  expect(capabilities.syncManager).toBe(false);
  expect(capabilities.registrationSync).toBe(false);
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await closeScannerDiagnostics(page);
  await resumeMeasurementScanner(page);
  return { manifest, capabilities };
}

/** Backgrounding intentionally exits scanning; resume the same enrolled device through its real control. */
export async function resumeMeasurementScanner(page: Page) {
  await page.bringToFront();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  if (!(await scanner.isVisible())) await page.getByRole("button", { name: "Start scanning", exact: true }).click();
  await expect(scanner).toBeVisible();
  await waitScannerPacing(page);
}

/** Read-only DOM/input observation: an unchanged prior feedback label cannot finish the timer. */
export async function measureScannerFeedback(page: Page, input: string, kind: FeedbackSample["kind"], label: string) {
  const key = `scanner-measurement-${randomUUID()}`;
  await page.evaluate(
    ({ key, label }) => {
      const feedback = document.querySelector(".pk-fast-scanner__feedback");
      if (!feedback) throw new Error("Actual scanner feedback region is required");
      const originalMark = feedback.querySelector(".pk-fast-scanner__mark");
      const state: { start: number | null; elapsed: number | null; cleanup?: () => void } = {
        start: null,
        elapsed: null,
      };
      const observe = () => {
        if (
          state.start !== null &&
          state.elapsed === null &&
          feedback.querySelector(".pk-fast-scanner__mark") !== originalMark &&
          feedback.textContent?.includes(label)
        )
          state.elapsed = performance.now() - state.start;
      };
      const onInput = (event: KeyboardEvent) => {
        if (event.key === "Enter" && state.start === null) state.start = performance.now();
      };
      const observer = new MutationObserver(observe);
      observer.observe(feedback, { childList: true, subtree: true, characterData: true });
      document.addEventListener("keydown", onInput, true);
      state.cleanup = () => {
        observer.disconnect();
        document.removeEventListener("keydown", onInput, true);
      };
      Reflect.set(window, key, state);
    },
    { key, label },
  );
  try {
    await page.keyboard.type(input);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate((key) => Reflect.get(window, key).elapsed as number | null, key))
      .not.toBeNull();
    const elapsedMs = await page.evaluate((key) => Reflect.get(window, key).elapsed as number, key);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    return { kind, elapsedMs };
  } finally {
    await page.evaluate((key) => {
      Reflect.get(window, key).cleanup();
      Reflect.deleteProperty(window, key);
    }, key);
  }
}

/** A real keyboard repeat inside the existing feedback pause must not become another operation. */
export async function expectPacedRepeatIgnored(page: Page, badge: string) {
  const before = await scannerStorage(page);
  const progress = page.getByRole("progressbar", { name: "Next badge readiness", exact: true });
  await expect(progress).toHaveAttribute("value");
  const interval = await page.evaluate(() => {
    const began = performance.now();
    const ready = document.querySelector<HTMLProgressElement>('[aria-label="Next badge readiness"]');
    return { began, remainingMs: ready ? ready.max - ready.value : null };
  });
  expect(interval.remainingMs).not.toBeNull();
  expect(interval.remainingMs).toBeGreaterThan(0);
  await page.keyboard.type(badge);
  await page.keyboard.press("Enter");
  const elapsedMs = await page.evaluate((start) => performance.now() - start, interval.began);
  expect(elapsedMs, "Repeat must actually arrive before the original feedback pause ends").toBeLessThan(
    interval.remainingMs!,
  );
  expect(await scannerStorage(page)).toEqual(before);
  return { elapsedMs, remainingMs: interval.remainingMs };
}

export async function waitScannerPacing(page: Page) {
  await page.bringToFront();
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => {
        const scanner = document.querySelector('[role="dialog"][aria-label="Continuous badge scanner"]');
        const progress = scanner?.querySelector<HTMLProgressElement>('[aria-label="Next badge readiness"]');
        return {
          scanner: Boolean(scanner),
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          fullscreen: Boolean(document.fullscreenElement),
          value: progress?.getAttribute("value") ?? null,
          max: progress?.max ?? null,
          ready: Boolean(progress?.hasAttribute("value") && progress.value === progress.max),
        };
      });
      // Firefox can exit fullscreen when a real permission request opens. Only an exited
      // scanner is resumed; an active saving/cooldown indicator must finish normally.
      if (!state.scanner) {
        await page.bringToFront();
        await page.getByRole("button", { name: "Start scanning", exact: true }).click();
      }
      return state;
    })
    .toMatchObject({ scanner: true, visibility: "visible", ready: true });
}

export async function leaveMeasurementScanner(page: Page) {
  await page.bringToFront();
  if (await page.getByRole("dialog", { name: "Continuous badge scanner", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Operator controls", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Scanner operator controls", exact: true })
      .getByRole("button", { name: "Exit", exact: true })
      .click();
  }
  await expect(page.getByRole("button", { name: "Start scanning", exact: true })).toBeVisible();
  await openScannerDiagnostics(page);
}

/** A committed real HTTP receipt is lost once; all later responses pass through unchanged. */
export async function loseFirstScanAcknowledgment(context: BrowserContext, original: Scan, delayMs: number) {
  const exchanges: Array<{ scan: Scan; receipt: Receipt; completedAtMs: number; delivery: "lost" | "delivered" }> = [];
  let losing = false;
  const pattern = `**${measurementApi}/scans`;
  const handler = async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const scan = enrolledEventScanRequestSchema.parse(route.request().postDataJSON());
    const lose = scan.operationId === original.operationId && !losing;
    if (lose) losing = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const receipt = eventScanResponseSchema.parse(await response.json());
    if (lose) {
      expect(scan).toEqual(original);
      exchanges.push({ scan, receipt, completedAtMs: performance.now(), delivery: "lost" });
      await route.abort("failed");
    } else {
      if (delayMs) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      exchanges.push({ scan, receipt, completedAtMs: performance.now(), delivery: "delivered" });
      await route.fulfill({ response });
    }
  };
  await context.route(pattern, handler);
  return { exchanges, stop: () => context.unroute(pattern, handler) };
}

export function distribution(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? null;
  return { samples: ordered.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
}

export async function originalPendingScans(page: Page, count: number) {
  const stored = await scannerStorage(page);
  expect(stored.pending).toHaveLength(count);
  expect(stored.history).toHaveLength(0);
  return stored.pending
    .map(({ scan }) => enrolledEventScanRequestSchema.parse(scan))
    .sort((left, right) => left.scannerSession.sequence - right.scannerSession.sequence);
}
