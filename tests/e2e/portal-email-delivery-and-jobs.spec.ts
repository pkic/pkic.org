import { test, expect } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("staff inspect delivery failures and edit a scheduled job interval", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-email-templates"));
  const id = "11111111111111111111111111111111";
  await page.route(`**/api/v1/email/outbox/${id}`, (route) =>
    route.fulfill({
      json: {
        message: {
          id,
          eventSlug: null,
          eventName: null,
          templateKey: "organization-invitation",
          templateVersion: 1,
          recipientEmail: "alex@example.test",
          recipientName: "Alex Example",
          subject: "Review your organization profile",
          messageType: "transactional",
          provider: "sendgrid",
          providerMessageId: null,
          status: "failed",
          attempts: 2,
          sendAfter: "2026-09-17T12:00:00.000Z",
          createdAt: "2026-09-17T12:00:00.000Z",
          updatedAt: "2026-09-17T12:01:00.000Z",
          sentAt: null,
          lastError:
            "The provider could not deliver the organization invitation. Check the recipient address before retrying.",
          bccRecipientCount: 0,
          hasCalendarInvite: false,
          hasBadgeAttachment: false,
          usesDirectBody: false,
          hasCustomText: false,
        },
      },
    }),
  );
  await page.goto(`/portal/#/settings/email-outbox/${id}`);
  await expect(page.getByRole("heading", { name: "Review your organization profile" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Check the recipient address");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByText("Alex Example <alex@example.test>", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`email-delivery-${width}.png`), fullPage: true });
  }
  await page.goto("/portal/#/settings/scheduled-jobs");
  await page.getByRole("button", { name: "Actions for Retention", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit schedule", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit job schedule" });
  await dialog.getByLabel("Interval (minutes)", { exact: true }).fill("0");
  await dialog.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Use an interval of at least 1 minute" })).toBeVisible();
  await dialog.getByLabel("Interval (minutes)", { exact: true }).fill("17");
  await dialog.getByRole("button", { name: "Save schedule", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Retention" })).toContainText("17 minutes");
  await page.screenshot({ path: test.info().outputPath("scheduled-jobs.png"), fullPage: true });
});
