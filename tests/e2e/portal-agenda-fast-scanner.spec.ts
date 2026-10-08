import { z } from "zod";
import { SCAN_STORAGE_VERSION } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage";
import { offlineScanRecordSchema } from "../../assets/shared/schemas/event-participation-scanning";
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
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import {
  openScannerDiagnostics,
  closeScannerDiagnostics,
  openScannerManualEntry,
} from "./helpers/scanner-recovery-storage";

test("phone scanner opens an immersive view and safely exits without camera permission", async ({
  page,
  context,
}, testInfo) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  await page.getByLabel("Scan mode", { exact: true }).selectOption("check");
  await openScannerDiagnostics(page);
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await closeScannerDiagnostics(page);
  await page.getByRole("button", { name: "Start scanning", exact: true }).click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner" });
  await expect(scanner).toBeVisible();
  await expect(page.getByLabel("Badge code", { exact: true })).toBeHidden();
  await expect(scanner.getByRole("button", { name: "Operator controls", exact: true })).toBeVisible();
  await expect(scanner.getByText(/^0 pending/)).toBeHidden();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-idle-clean-phone.png") });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-idle-clean-dark-phone.png") });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  const controls = scanner.getByRole("dialog", { name: "Scanner operator controls", exact: true });
  await expect(controls.getByText(/^0 pending/)).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-idle-operator-phone.png") });
  await controls.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(page.getByLabel("Badge code", { exact: true })).toBeHidden();
  await openScannerManualEntry(page);
  await expect(page.getByLabel("Badge code", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test("continuous local eligibility checks queue a burst while attempt uploads are stalled", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const templateEmail = `fast-template-${randomUUID()}@example.test`;
  const templateSince = await capturedEmailCount();
  const template = await registerInBrowser(page, templateEmail);
  const templateConfirmation = await waitForCapturedEmail(templateEmail, "Confirm your registration", {
    since: templateSince,
  });
  await page.goto(extractEmailUrl(templateConfirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(templateEmail, "registration is confirmed", { since: templateSince });
  const emails = Array.from({ length: 3 }, () => `fast-attendee-${randomUUID()}@example.test`);
  for (const email of emails) {
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
    await page.getByRole("button", { name: /Confirm my registration/i }).click();
    await waitForCapturedEmail(email, "registration is confirmed", { since });
  }
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
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
  await page.route("**/scans", async () => {
    uploads++;
    await new Promise(() => {});
  });
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  await expect(page.getByLabel("Scan mode", { exact: true })).toHaveValue("attendance");
  await openScannerDiagnostics(page);
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await closeScannerDiagnostics(page);
  await page.getByRole("button", { name: "Start scanning", exact: true }).click();
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
  const captured = queued.map((record) =>
    offlineScanRecordSchema
      .extend({
        leaseUntil: z.number(),
        owner: z.string().nullable(),
        attempts: z.number().optional(),
        nextAttemptAt: z.number().optional(),
      })
      .parse(record),
  );
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
  await expect(controls.getByText(/^4 pending/)).toBeVisible();
  await controls.getByRole("button", { name: "Exit", exact: true }).click();
  await page.getByLabel("Scan mode", { exact: true }).selectOption("checkout");
  await page.getByRole("button", { name: "Start scanning", exact: true }).click();
  await expect(scanner).toBeVisible();
  await expect(ready).toHaveJSProperty("value", 1000);
  // The same known badge lacks physical-day entry entitlement, but departure needs no admission.
  await page.keyboard.type(credentials[3]);
  await page.keyboard.press("Enter");
  await expect(feedback).toContainText("Checkout saved on device");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scanner-checkout-clean-phone.png") });
  await scanner.getByRole("button", { name: "Operator controls", exact: true }).click();
  await expect(controls.getByText(/^5 pending/)).toBeVisible();
  await expect(controls.getByText("Admission recorded", { exact: true })).toHaveCount(0);
  await expect(controls.getByText("Checkout recorded", { exact: true })).toHaveCount(0);
  await controls.getByRole("button", { name: "Exit", exact: true }).click();
});
