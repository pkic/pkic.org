import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { randomUUID } from "node:crypto";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import {
  badgeAttendeesResponseSchema,
  badgeIssueResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("phone scanner opens an immersive view and safely exits without camera permission", async ({
  page,
  context,
}, testInfo) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await page.getByRole("button", { name: "Start scanning", exact: true }).click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner" });
  await expect(scanner).toBeVisible();
  await expect(page.getByLabel("Badge code", { exact: true })).toBeHidden();
  await expect(scanner.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
  await expect(scanner.getByText("0 pending", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scanner-immersive-phone.png") });
  await scanner.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(scanner).toHaveCount(0);
  await expect(page.getByLabel("Badge code", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("continuous local verification queues a burst while attendance uploads are stalled", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const template = await registerInBrowser(page, `fast-template-${randomUUID()}@example.test`);
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
  for (const email of emails) {
    const response = await page.request.get(
      `/api/v1/events/pqc-conference-amsterdam-nl/badges/attendees?q=${encodeURIComponent(email)}&sort=email&limit=10&offset=0`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const user = badgeAttendeesResponseSchema.parse(await response.json()).users.find((user) => user.email === email);
    expect(user).toBeDefined();
    const issued = await page.request.post("/api/v1/events/pqc-conference-amsterdam-nl/badges", {
      data: { userId: user!.id },
    });
    expect(issued.status(), await issued.text()).toBe(200);
    credentials.push(badgeIssueResponseSchema.parse(await issued.json()).credential);
  }
  let uploads = 0;
  await page.route("**/scans", async () => {
    uploads++;
    await new Promise(() => {});
  });
  await page.goto("/portal/#/events/pqc-conference-amsterdam-nl/scanner");
  await page.getByLabel("Feedback pause", { exact: true }).selectOption("1000");
  await page.getByRole("button", { name: "Start scanning", exact: true }).click();
  const scanner = page.getByRole("dialog", { name: "Continuous badge scanner" });
  for (const credential of credentials) {
    await expect(scanner.getByText("Ready for the next badge", { exact: true })).toBeVisible();
    await page.keyboard.type(credential);
    await page.keyboard.press("Enter");
    await expect(scanner.getByText("Eligibility verified", { exact: true })).toBeVisible();
  }
  await expect(scanner.getByText("3 pending", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scanner-local-verified-phone.png") });
  await expect(scanner.getByText("All pending scans uploaded.", { exact: true })).toHaveCount(0);
  await expect(scanner.getByText("Attendance recorded", { exact: true })).toHaveCount(0);
  await expect.poll(() => uploads).toBeGreaterThan(0);
  await expect(scanner.getByText("Ready for the next badge", { exact: true })).toBeVisible();
  await page.keyboard.type("invalid-qr-content");
  await page.keyboard.press("Enter");
  await expect(scanner.getByText("Unknown badge", { exact: true })).toBeVisible();
  await expect(scanner.getByText("3 pending", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scanner-invalid-qr-phone.png") });
  await scanner.getByRole("button", { name: "Exit", exact: true }).click();
});
