import { expect, test } from "@playwright/test";
import { eventAnalyticsResponseSchema } from "../../assets/shared/schemas/event-analytics";
import { eventAnalyticsFixture } from "../helpers/event-analytics";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("attendance tables use the panel width and chart labels keep a readable size", async ({ page }, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("portal-analytics"));
  const slug = "pqc-conference-amsterdam-nl";
  const response = eventAnalyticsFixture();
  response.event.slug = slug;
  response.attendanceChanges.changedAttendees = 69;
  response.attendanceChanges.byDay = [
    {
      day_date: "2026-12-01",
      sort_order: 1,
      label: "Tuesday 1 December 2026",
      changed_attendees: 69,
      left_in_person_attendees: 39,
      joined_in_person_attendees: 12,
      day_changes: 84,
    },
  ];
  response.attendanceChanges.byTransition = [
    { from_type: "in_person", to_type: "virtual", attendees: 30, day_changes: 84 },
  ];
  await page.route(`**/api/v1/events/${slug}/analytics`, (route) =>
    route.fulfill({ json: eventAnalyticsResponseSchema.parse(response) }),
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/portal/#/events/${slug}/stats/attendance`);
    const where = page.getByRole("table", { name: "Where attendance changed", exact: true });
    const how = page.getByRole("table", { name: "How attendance changed", exact: true });
    await expect(where).toBeVisible();
    const a = await where.boundingBox();
    const b = await how.boundingBox();
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);
    if (width >= 768) {
      expect(
        await where.locator("..").evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`attendance-${width}.png`), fullPage: true });
    await page.goto(`/portal/#/events/${slug}/stats/overview`);
    const plot = page.locator(".pk-chart__plot").first();
    await expect(plot).toBeVisible();
    await expect
      .poll(() =>
        plot.evaluate((svg) => {
          const text = svg.querySelector("text")!;
          return text.getBoundingClientRect().height;
        }),
      )
      .toBeGreaterThanOrEqual(10);
    expect(
      await plot
        .locator("text")
        .first()
        .evaluate((text) => text.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(16);
    await page.screenshot({ path: testInfo.outputPath(`analytics-${width}.png`), fullPage: true });
  }
});
