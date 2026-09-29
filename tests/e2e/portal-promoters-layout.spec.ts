import { expect, test } from "@playwright/test";
import { eventPromotersListResponseSchema } from "../../assets/shared/schemas/event-promoters";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const slug = "pqc-conference-amsterdam-nl";

test("promoter charts keep vertical scrolling on the page", async ({ page }, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("browser-presentation"));
  const promoters = Array.from({ length: 25 }, (_, index) => ({
    userId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    email: `user${index + 1}@example.test`,
    firstName: "Alex",
    lastName: `Example ${index + 1}`,
    organization: "Example Forms Association",
    jobTitle: "Form designer",
    headshotUrl: null,
    invitesSent: 8,
    invitesAccepted: 4,
    invitesDeclined: 1,
    invitesExpired: 1,
    inviteConversionRate: 50,
    lastInviteAt: null,
    referralCodesIssued: 1,
    referralClicks: 40,
    referralConversions: 10,
    impactScore: 14,
  }));
  const response = eventPromotersListResponseSchema.parse({
    eventSlug: slug,
    view: "promoters",
    promoters,
    referralCodes: [],
    page: { limit: 50, offset: 0, total: 25, hasMore: false },
    summary: {
      activePromoters: 25,
      promotersWithRegistrations: 25,
      totalInvitesSent: 200,
      totalInvitesAccepted: 100,
      totalReferralClicks: 1000,
      totalReferralConversions: 250,
      referralCodeCount: 25,
    },
  });
  await page.route(`**/api/v1/events/${slug}/promoters?*`, (route) => route.fulfill({ json: response }));
  await page.goto(`/portal/#/events/${slug}/promoters`);
  const table = page.getByRole("table", { name: "Promoters, ranked by impact", exact: true });
  await expect(table.getByRole("link", { name: "Open Alex Example 25", exact: true })).toBeAttached();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const chooser = table.getByRole("button", { name: "Choose columns" });
    await expect(chooser).toBeVisible();
    const rightInset = await chooser.evaluate((button) => {
      const cell = button.closest("th")!;
      return cell.getBoundingClientRect().right - button.getBoundingClientRect().right;
    });
    expect(rightInset).toBeLessThanOrEqual(25);
    const dimensions = await table.locator("..").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
    await expect(table).not.toContainText("@example.test");
    await page.screenshot({ path: testInfo.outputPath(`promoters-${width}.png`) });
    await table.getByRole("link", { name: "Open Alex Example 25", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await table.locator("..").evaluate((element) => element.scrollTop)).toBe(0);
    await expect(page.getByRole("table", { name: "Invitations from Alex Example 25", exact: true })).toBeAttached();
    await page.screenshot({ path: testInfo.outputPath(`promoters-last-row-${width}.png`) });
  }
});
