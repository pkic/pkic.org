import {
  scannerDeviceSessionEnrollmentResponseSchema,
  scannerDeviceSessionClosingSchema,
  scannerDeviceSessionStatusSchema,
} from "../../assets/shared/schemas/event-scanner-devices";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { randomUUID } from "node:crypto";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import {
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { ownDomainEmail, registerInBrowser } from "./helpers/registration";
import { registerSignedIn } from "./helpers/registrant";
import { capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  addSyntheticPreparedScannerEvent,
  openScannerSessionDetails,
  queuedScanSchema,
  removeSyntheticPreparedScannerEvent,
} from "./helpers/scanner-recovery-storage";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import { instantToCalendarDate } from "../../assets/shared/timezone";
import { USER_SESSION_STATE_CHANGED } from "../../assets/ts/shared/pending-user-logout";
import QRCode from "qrcode";

test("badge collection opens for an upcoming event after daily preparation", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  await context.clearPermissions();
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-fast-scanner-idle"));
  const date = instantToCalendarDate(new Date(Date.now() + 13 * 24 * 60 * 60_000), "UTC");
  const event = await createRegistrationEvent(page, "badge-collection-early", {
    date,
    startTime: "09:00",
    endTime: "17:00",
  });
  const attendeeEmail = ownDomainEmail("badge-collection-offline");
  // Registering signs a browser in as the attendee, so it gets its own; this page stays staff.
  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    await registerStateAttendee(await attendeeContext.newPage(), event, attendeeEmail);
  } finally {
    await attendeeContext.close();
  }
  await page.setExtraHTTPHeaders({});
  const attendeeResponse = await page.request.get(
    `/api/v1/events/${event.slug}/badges/attendees?q=${encodeURIComponent(attendeeEmail)}&sort=email&limit=10&offset=0`,
  );
  expect(attendeeResponse.status(), await attendeeResponse.text()).toBe(200);
  const attendee = badgeAttendeesResponseSchema
    .parse(await attendeeResponse.json())
    .users.find((user) => user.email === attendeeEmail);
  expect(attendee).toBeDefined();
  const issueResponse = await page.request.post(`/api/v1/events/${event.slug}/badges`, {
    data: badgeIssueRequestSchema.parse({ operationId: randomUUID(), userId: attendee!.id }),
  });
  expect(issueResponse.status(), await issueResponse.text()).toBe(200);
  const badge = badgeIssueResponseSchema.parse(await issueResponse.json());
  if (badge.result !== "issued") throw new Error("A fresh operation must issue a printable badge credential");
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  let firstCollectionRequest = true;
  let refreshStatus: number | null = null;
  let refreshAttempts = 0;
  await page.route("**/offline-eligibility?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("includeBadgeNames") !== "true") return route.continue();
    if (!firstCollectionRequest) {
      if (!refreshStatus) return route.continue();
      refreshAttempts++;
      return route.fulfill({
        status: refreshStatus,
        contentType: "application/json",
        headers: refreshStatus === 429 ? { "Retry-After": "120" } : undefined,
        body: "{}",
      });
    }
    firstCollectionRequest = false;
    await preparationGate;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  let firstEnrollmentRequest = true;
  await page.route("**/scanner/devices/sessions", async (route) => {
    if (!firstEnrollmentRequest) return route.continue();
    firstEnrollmentRequest = false;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  const enrolled = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/scanner/devices/sessions") &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.goto(`/portal/#/groups/${event.ownerGroupId}/events/${event.eventId}/scanner`);
  const retryDevice = page.getByRole("button", { name: "Retry scanner preparation", exact: true });
  await expect(retryDevice).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-device-error-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-device-error-phone.png") });
  await retryDevice.click();
  const enrollment = scannerDeviceSessionEnrollmentResponseSchema.parse(await (await enrolled).json());
  await page.setViewportSize({ width: 1280, height: 720 });
  const collection = page.getByRole("button", { name: "Badge collection", exact: true });
  await expect(collection).toBeEnabled();
  const launch = page.getByRole("tabpanel", { name: "Scan", exact: true });
  await expect(launch).not.toContainText(/Preparing badge checks|Badge data changed during refresh/);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-launch-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(collection.locator(".pk-action-tile__hint")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-launch-phone.png") });
  await collection.click();
  const preparation = page.getByRole("dialog", { name: "Prepare badge collection", exact: true });
  await expect(preparation).toBeVisible();
  await expect(preparation).toContainText("Preparing badge names");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-progress-phone.png") });
  releasePreparation();
  await expect(preparation.getByRole("alert")).toContainText("Try again shortly");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-error-phone.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-error-desktop.png") });
  await preparation.getByRole("button", { name: "Retry preparation", exact: true }).click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  await expect(scanner).toBeVisible();
  await expect(scanner.getByRole("status", { name: "Scanner status", exact: true })).toHaveAttribute(
    "title",
    "All scans synced",
    { timeout: 15_000 },
  );
  await expect(scanner.locator(".pk-fast-scanner__feedback")).toHaveText("Ready for badge collection");
  await expect(scanner.locator(".pk-fast-scanner__feedback")).not.toContainText("Ready to scan");
  await expect(scanner.getByText("Starting camera…", { exact: true })).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-desktop.png") });
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.badgePrintCalls = String(
        Number(document.documentElement.dataset.badgePrintCalls ?? 0) + 1,
      );
    };
  });
  await page.keyboard.type(badge.credential);
  await page.keyboard.press("Enter");
  await expect(scanner.getByLabel("Attendee name", { exact: true })).toContainText("Synthetic Attendee");
  const labelResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/events/${event.slug}/badges/labels`) &&
      response.request().method() === "POST",
  );
  await scanner.getByRole("button", { name: "Print this badge", exact: true }).click();
  expect((await labelResponse).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.badgePrintCalls ?? 0))).toBe(1);
  await expect(scanner).toBeVisible();
  await expect(scanner.locator(".pk-fast-scanner__feedback")).toContainText("Print requested");
  await expect(page).not.toHaveURL(/\/print(?:\?|$)/);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-print-desktop.png") });
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-print-phone.png") });
  await page.setViewportSize({ width: 1280, height: 720 });
  await scanner.getByRole("button", { name: "Next attendee", exact: true }).click();
  await scanner.getByRole("button", { name: "Close scanner", exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await collection.click();
  await expect(scanner).toBeVisible();
  await expect(scanner.getByRole("status", { name: "Scanner status", exact: true })).toHaveAttribute(
    "title",
    "All scans synced",
  );
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("badge-collection-phone.png") });
  const serverClose = await page.request.post(
    `/api/v1/events/${event.slug}/scanner/devices/sessions/${enrollment.epochId}/closing`,
    {
      data: scannerDeviceSessionClosingSchema.parse({
        operationId: randomUUID(),
        highWaterSequence: 1,
        pendingCount: 0,
        recoveryCount: 0,
      }),
    },
  );
  const serverClosedStatus = await serverClose.json();
  expect(serverClose.status(), JSON.stringify(serverClosedStatus)).toBe(200);
  expect(scannerDeviceSessionStatusSchema.parse(serverClosedStatus).closedAt).not.toBeNull();
  const resumption = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/scanner/devices/sessions/${enrollment.epochId}/resumption`) &&
      response.request().method() === "POST",
  );
  await page.reload();
  expect((await resumption).status()).toBe(200);
  await page.getByRole("button", { name: "Badge collection", exact: true }).click();
  await expect(scanner).toBeVisible();
  await expect(scanner.locator(".pk-fast-scanner__feedback")).toHaveText("Ready for badge collection");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("server-resumed-phone.png") });
  for (const status of [500, 403, 429]) {
    refreshStatus = status;
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.status() === status &&
          new URL(response.url()).pathname.endsWith("/offline-eligibility") &&
          new URL(response.url()).searchParams.get("includeBadgeNames") === "true",
      ),
      page.evaluate(() => window.dispatchEvent(new Event("focus"))),
    ]);
    await expect(scanner).toBeVisible();
    await expect(scanner.locator(".pk-fast-scanner__feedback")).toHaveText("Ready for badge collection");
  }
  expect(refreshAttempts).toBe(3);
  const uploadStatuses = [500, 403, 429];
  let uploadAttempts = 0;
  await page.route(new RegExp(`/api/v1/events/${event.slug}/scans$`), async (route) => {
    const status = uploadStatuses[Math.min(uploadAttempts++, uploadStatuses.length - 1)]!;
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: status === 429 ? { "Retry-After": "120" } : undefined,
      body: "{}",
    });
  });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await expect(scanner.getByRole("status", { name: "Scanner status", exact: true })).toContainText("Offline");
  await page.keyboard.type(badge.credential);
  await page.keyboard.press("Enter");
  await expect(scanner.getByLabel("Attendee name", { exact: true })).toContainText("Synthetic Attendee");
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  const controls = scanner.getByRole("dialog", { name: "Scanner operator controls", exact: true });
  await expect(controls.getByText(/^1 pending/)).toBeVisible();
  await controls.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await context.setOffline(false);
  await expect.poll(() => uploadAttempts, { timeout: 30000 }).toBe(3);
  await expect(scanner).toBeVisible();
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(controls.getByText(/^1 pending/)).toBeVisible();
  await controls.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 375, height: 812 });
  await reopened.goto("/portal/");
  await expect(reopened.getByRole("heading", { name: "Continue scanning offline", exact: true })).toBeVisible();
  await reopened.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), USER_SESSION_STATE_CHANGED);
  await expect(reopened.getByRole("heading", { name: "Continue scanning offline", exact: true })).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Badge collection/ })).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Record attendance/ })).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Admission decision/ })).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Check registration only/ })).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Record checkout/ })).toBeVisible();
  await reopened.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(reopened.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Continue scanning offline", exact: true })).toBeVisible();
  await reopened.screenshot({ animations: "disabled", path: testInfo.outputPath("offline-scanner-sign-in-phone.png") });
  await reopened.getByRole("button", { name: "Continue scanning offline", exact: true }).click();
  await expect(reopened.getByRole("heading", { name: "Continue scanning offline", exact: true })).toBeVisible();
  const syntheticEventSlug = "pqc-conference-toronto-ca";
  const syntheticKey = await addSyntheticPreparedScannerEvent(reopened, event.slug, syntheticEventSlug);
  await reopened.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), USER_SESSION_STATE_CHANGED);
  const eventSelector = reopened.getByRole("combobox", { name: "Event", exact: true });
  await expect(eventSelector).toBeVisible();
  await expect(reopened.getByRole("link", { name: /^Badge collection/ })).toHaveCount(1);
  await reopened.screenshot({ animations: "disabled", path: testInfo.outputPath("offline-event-selector-phone.png") });
  await eventSelector.selectOption(syntheticEventSlug);
  await expect(reopened.getByRole("link", { name: /^Badge collection/ })).toHaveAttribute("href", /toronto/);
  await reopened.setViewportSize({ width: 1280, height: 720 });
  await reopened.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("offline-event-selector-desktop.png"),
  });
  await removeSyntheticPreparedScannerEvent(reopened, syntheticKey);
  await reopened.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), USER_SESSION_STATE_CHANGED);
  await expect(eventSelector).toHaveCount(0);
  await reopened.setViewportSize({ width: 375, height: 812 });
  await reopened.screenshot({ animations: "disabled", path: testInfo.outputPath("offline-scanner-entry-phone.png") });
  await reopened.setViewportSize({ width: 1280, height: 720 });
  await reopened.screenshot({ animations: "disabled", path: testInfo.outputPath("offline-scanner-entry-desktop.png") });
  const cameraFrame = await QRCode.toDataURL(badge.credential, { width: 100, margin: 4 });
  await reopened.evaluate(async (frame) => {
    const image = new Image();
    image.src = frame;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d")!;
    const paint = () => {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, (canvas.width - image.width) / 2, (canvas.height - image.height) / 2);
    };
    paint();
    window.setInterval(paint, 125);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => canvas.captureStream(8),
    });
  }, cameraFrame);
  await reopened.getByRole("link", { name: /^Badge collection/ }).click();
  await reopened.getByRole("button", { name: "Start scanning", exact: true }).click();
  const reopenedScanner = reopened.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  await expect(reopenedScanner).toBeVisible();
  await expect(reopenedScanner.getByRole("status", { name: "Scanner status", exact: true })).toContainText(
    "Saved scanner",
  );
  await expect(reopenedScanner.getByLabel("Attendee name", { exact: true })).toContainText("Synthetic Attendee", {
    timeout: 15_000,
  });
  await reopenedScanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(
    reopenedScanner.getByRole("dialog", { name: "Scanner operator controls", exact: true }).getByText(/^2 pending/),
  ).toBeVisible();
  await reopened.goto("/portal/");
  await reopened.evaluate(async () => {
    const request = indexedDB.open("pkic-scanner-eligibility", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open saved badge data"));
    });
    try {
      const transaction = db.transaction("manifests", "readwrite");
      transaction.objectStore("manifests").clear();
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear saved badge data"));
      });
    } finally {
      db.close();
    }
  });
  await reopened.getByRole("link", { name: /^Badge collection/ }).click();
  await reopened.getByRole("button", { name: "Start scanning", exact: true }).click();
  await expect(reopenedScanner).toBeVisible();
  await reopened.keyboard.type(badge.credential);
  await reopened.keyboard.press("Enter");
  await expect(reopenedScanner.locator(".pk-fast-scanner__feedback")).toContainText("Verification pending");
  await reopened.goto("/portal/");
  await reopened.getByRole("link", { name: /^Record checkout/ }).click();
  await reopened.getByRole("button", { name: "Start scanning", exact: true }).click();
  await expect(reopenedScanner).toBeVisible();
  await reopened.keyboard.type(badge.credential);
  await reopened.keyboard.press("Enter");
  await reopenedScanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(
    reopenedScanner.getByRole("dialog", { name: "Scanner operator controls", exact: true }).getByText(/^4 pending/),
  ).toBeVisible();
});

test("phone scanner guides staff through venue, search, offline entry and diagnostics", async ({
  page,
  context,
}, testInfo) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-fast-scanner-idle"));
  const enrolled = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/scanner/devices/sessions") && response.request().method() === "POST",
  );
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  const enrollment = scannerDeviceSessionEnrollmentResponseSchema.parse(await (await enrolled).json());
  const entrance = page.getByRole("button", { name: "Record attendance", exact: true });
  await expect(entrance).toBeEnabled();
  await expect(page.getByLabel("Scan mode", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeHidden();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-setup-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-setup-phone.png") });
  await entrance.click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  await expect(scanner).toBeVisible();
  await expect(scanner.getByRole("status", { name: "Scanner status", exact: true })).toHaveAttribute(
    "title",
    "All scans synced",
  );
  await scanner.getByRole("button", { name: "Find attendee or badge", exact: true }).click();
  await expect(scanner.getByLabel("Badge code or attendee", { exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-search-phone.png") });
  await context.setOffline(true);
  await expect(scanner.getByLabel("Badge code", { exact: true })).toBeVisible();
  const status = scanner.getByRole("status", { name: "Scanner status", exact: true });
  await expect(status.getByText("Offline", { exact: true })).toBeVisible();
  await expect(status).not.toContainText("All scans synced");
  await expect(scanner.getByText(/Offline: use a badge code/)).toBeVisible();
  await context.setOffline(false);
  await scanner.getByRole("button", { name: "Return to scanning", exact: true }).click();
  await scanner.getByRole("button", { name: "Close scanner", exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await page.getByRole("tab", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeVisible();
  await expect(page.getByText("These preferences save automatically in this browser.")).toBeVisible();
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("300");
  await page.reload();
  await expect(page.getByLabel("Feedback pause", { exact: true })).toHaveValue("300");
  const closed = await page.request.post(
    `/api/v1/events/pqc-conference-amsterdam-nl/scanner/devices/sessions/${enrollment.epochId}/closing`,
    {
      data: scannerDeviceSessionClosingSchema.parse({
        operationId: randomUUID(),
        highWaterSequence: 0,
        pendingCount: 0,
        recoveryCount: 0,
      }),
    },
  );
  expect(closed.status()).toBe(200);
  expect(scannerDeviceSessionStatusSchema.parse(await closed.json()).closedAt).not.toBeNull();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await openScannerSessionDetails(page);
  const nextSession = page.getByRole("button", { name: "Start next scanner session", exact: true });
  await expect(nextSession).toBeVisible();
  await expect(page.getByRole("button", { name: "Close scanner session", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("server-closed-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: testInfo.outputPath("server-closed-phone.png"), fullPage: true });
  await nextSession.click();
  await expect(page.getByRole("button", { name: "Close scanner session", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Continuous badge scanner", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Scan", exact: true }).click();
  await page.getByRole("button", { name: "Sessions Choose a room", exact: true }).click();
  const rooms = page.getByRole("dialog", { name: "Choose a room", exact: true });
  await expect(rooms).toBeVisible();
  await expect(rooms.getByRole("button", { name: "All sessions", exact: true })).toBeVisible();
  await rooms.getByRole("button", { name: "All sessions", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "All sessions", exact: true }).getByRole("tab", { name: "Other", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("continuous local eligibility checks queue a burst while attempt uploads are stalled", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const templateEmail = ownDomainEmail("fast-template");
  const templateSince = await capturedEmailCount();
  const template = await registerInBrowser(page, templateEmail, undefined, undefined, {
    organization: `Fast Scanner Template Org ${Date.now()}`,
  });
  // A verified registration is final when submitted: no confirmation step follows.
  await waitForCapturedEmail(templateEmail, "registration is confirmed", { since: templateSince });
  const emails = Array.from({ length: 3 }, () => ownDomainEmail("fast-attendee"));
  for (const [index, email] of emails.entries()) {
    // Each address has its own domain, and a named organization belongs to the one domain that claimed it.
    await registerSignedIn(
      page,
      "pqc-conference-amsterdam-nl",
      registrationCreateSchema.parse({
        ...template.request,
        email,
        dayAttendance: template.request.dayAttendance?.map((day) => ({ ...day, attendanceType: "in_person" })),
      }),
      { organization: `Fast Scanner Attendee Org ${index + 1} ${Date.now()}` },
    );
  }
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-fast-scanner-burst"));
  const credentials: string[] = [];
  for (const email of [...emails, templateEmail]) {
    const response = await page.request.get(
      `/api/v1/events/pqc-conference-amsterdam-nl/badges/attendees?q=${encodeURIComponent(email)}&sort=email&limit=10&offset=0`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const user = badgeAttendeesResponseSchema.parse(await response.json()).users.find((user) => user.email === email);
    expect(user).toBeDefined();
    const issued = await page.request.post("/api/v1/events/pqc-conference-amsterdam-nl/badges", {
      data: badgeIssueRequestSchema.parse({ operationId: randomUUID(), userId: user!.id }),
    });
    expect(issued.status(), await issued.text()).toBe(200);
    const badge = badgeIssueResponseSchema.parse(await issued.json());
    if (badge.result !== "issued") throw new Error("A fresh operation must issue a printable badge credential");
    credentials.push(badge.credential);
  }
  let uploads = 0;
  let holdUploads = true;
  let releaseUploads!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUploads = resolve;
  });
  const scanUploads = /\/scans(?:\/failures)?$/;
  await page.route(scanUploads, async (route) => {
    uploads++;
    if (holdUploads) await uploadGate;
    await route.continue().catch(() => {});
  });
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  await page.getByRole("tab", { name: "Diagnostics", exact: true }).click();
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveCount(0);
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await page.getByRole("tab", { name: "Scan", exact: true }).click();
  await page.getByRole("button", { name: "Record attendance", exact: true }).click();
  const attendeeField = page.getByLabel("Badge code or attendee", { exact: true });
  await page.getByRole("button", { name: "Find attendee or badge", exact: true }).click();
  await attendeeField.fill(emails[0]!);
  await expect(attendeeField).not.toHaveAttribute("aria-invalid", "true");
  const selectedBadge = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/badge") &&
      new URL(response.url()).pathname.includes("/scans/attendees/"),
  );
  await page.getByRole("group", { name: "Matching attendees", exact: true }).getByRole("button").click();
  expect((await selectedBadge).status()).toBe(200);
  await expect(attendeeField).toHaveValue(new RegExp(emails[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await page.getByRole("button", { name: "Return to scanning", exact: true }).click();

  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner" });
  const ready = scanner.getByRole("progressbar", { name: "Next badge readiness", exact: true });
  const feedback = scanner.getByRole("status").and(scanner.locator(".pk-fast-scanner__feedback"));
  await expect(feedback).toHaveCount(1);
  for (const credential of credentials.slice(0, 3)) {
    await expect(ready).toHaveJSProperty("value", 1000);
    await page.keyboard.type(credential);
    await page.keyboard.press("Enter");
    // Venue eligibility depends on today in the event zone; the queue must remain responsive outside event dates too.
    await expect(feedback).toContainText(/Registered · scan saved on device|Known badge · not registered/);
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-known-badge-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  const controls = scanner.getByRole("dialog", { name: "Scanner operator controls", exact: true });
  await expect(controls.getByText(/^3 pending/)).toBeVisible();
  await expect(controls.getByText("All pending scans uploaded.", { exact: true })).toHaveCount(0);
  await expect(controls.getByText("Attendance recorded", { exact: true })).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-pending-operator-phone.png") });
  await controls.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await expect.poll(() => uploads).toBeGreaterThan(0);
  await expect(ready).toHaveJSProperty("value", 1000);
  await page.keyboard.type(credentials[3]);
  await page.keyboard.press("Enter");
  await expect(feedback).toContainText("Known badge · not registered");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-orange-clean-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(controls.getByText(/^4 pending/)).toBeVisible();
  const queued = await page.evaluate(async (version) => {
    const opening = indexedDB.open("pkic-scanner-outbox", version);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error("Scanner queue open failed"));
    });
    try {
      const read = db.transaction("scans").objectStore("scans").getAll();
      return await new Promise<unknown[]>((resolve, reject) => {
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error("Scanner queue read failed"));
      });
    } finally {
      db.close();
    }
  }, SCAN_STORAGE_VERSION);
  const captured = queued.map((record) => queuedScanSchema.parse(record));
  expect(captured).toHaveLength(4);
  expect(captured.map((record) => record.scan.badgeId)).toEqual(expect.arrayContaining(credentials));
  for (const record of captured) {
    expect(record.scan.action).toBe("attendance");
    expect(record.scan.offlineRight).toBeUndefined();
  }
  await expect(scanner.getByRole("button", { name: "Review admission exception", exact: true })).toHaveCount(0);

  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-orange-operator-phone.png") });
  await controls.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await expect(ready).toHaveJSProperty("value", 1000);
  await page.keyboard.type("invalid-qr-content");
  await page.keyboard.press("Enter");
  await expect(feedback).toContainText("Unknown badge");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-unknown-clean-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(controls.getByText(/^5 pending/)).toBeVisible();
  await controls.getByRole("button", { name: "Close scanner", exact: true }).click();
  await page.getByRole("button", { name: "Record checkout", exact: true }).click();
  await expect(scanner).toBeVisible();
  await expect(ready).toHaveJSProperty("value", 1000);
  // The same known badge lacks physical-day entry entitlement, but departure needs no admission.
  await page.keyboard.type(credentials[3]);
  await page.keyboard.press("Enter");
  await expect(feedback).toContainText("Checkout saved on device");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-checkout-clean-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(controls.getByText(/^6 pending/)).toBeVisible();
  await expect(controls.getByText("Admission recorded", { exact: true })).toHaveCount(0);
  await expect(controls.getByText("Checkout recorded", { exact: true })).toHaveCount(0);
  holdUploads = false;
  releaseUploads();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(controls.getByText(/^0 pending/)).toBeVisible({ timeout: 30000 });
  await controls.getByRole("button", { name: "Close operator controls", exact: true }).click();
  await expect(scanner.getByRole("status", { name: "Scanner status", exact: true })).toHaveAttribute(
    "title",
    "All scans synced",
  );
  await scanner.getByRole("button", { name: "Close scanner", exact: true }).click();
});
