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
import { confirmRegistration, ownDomainEmail, registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { queuedScanSchema } from "./helpers/scanner-recovery-storage";

test("phone scanner guides staff through venue, search, offline entry and diagnostics", async ({
  page,
  context,
}, testInfo) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-fast-scanner-idle"));
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  const entrance = page.getByRole("button", { name: "Venue entrance Check people in", exact: true });
  await expect(entrance).toBeEnabled();
  await expect(page.getByLabel("Scan mode", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sync now", exact: true })).toBeHidden();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-setup-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-setup-phone.png") });
  await entrance.click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner", exact: true });
  await expect(scanner).toBeVisible();
  await expect(scanner.getByText("All scans synced", { exact: true })).toBeVisible();
  await scanner.getByRole("button", { name: "Find attendee or badge", exact: true }).click();
  await expect(scanner.getByLabel("Badge code or attendee", { exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-search-phone.png") });
  await context.setOffline(true);
  await expect(scanner.getByLabel("Badge code", { exact: true })).toBeVisible();
  await expect(scanner.getByText("Offline · no pending scans", { exact: true })).toBeVisible();
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
    organization: "Fast Scanner Template Org",
  });
  // A verified registration is final when submitted: no confirmation step follows.
  await waitForCapturedEmail(templateEmail, "registration is confirmed", { since: templateSince });
  const emails = Array.from({ length: 3 }, () => ownDomainEmail("fast-attendee"));
  for (const [index, email] of emails.entries()) {
    const since = await capturedEmailCount();
    const body = registrationCreateSchema.parse({
      ...template.request,
      email,
      attendanceType: "in_person",
      dayAttendance: template.request.dayAttendance?.map((day) => ({ ...day, attendanceType: "in_person" })),
    });
    const registered = await page.request.post("/api/v1/events/pqc-conference-amsterdam-nl/registrations", {
      data: body,
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
    await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
    // Each address has its own domain, and a named organization belongs to the one domain that claimed it.
    await confirmRegistration(page, `Fast Scanner Attendee Org ${index + 1}`);
    await waitForCapturedEmail(email, "registration is confirmed", { since });
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
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await page.getByRole("tab", { name: "Scan", exact: true }).click();
  await page.getByRole("button", { name: "Venue entrance Check people in", exact: true }).click();
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
    await expect(feedback).toContainText("Registered · scan saved on device");
  }
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-green-clean-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  const controls = scanner.getByRole("dialog", { name: "Scanner operator controls", exact: true });
  await expect(controls.getByText(/^3 pending/)).toBeVisible();
  await expect(controls.getByText("All pending scans uploaded.", { exact: true })).toHaveCount(0);
  await expect(controls.getByText("Attendance recorded", { exact: true })).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-green-operator-phone.png") });
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
  await page.getByRole("button", { name: "Venue exit Check people out", exact: true }).click();
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
  await expect(scanner.getByText("All scans synced", { exact: true })).toBeVisible({ timeout: 30000 });
  await controls.getByRole("button", { name: "Close scanner", exact: true }).click();
});
