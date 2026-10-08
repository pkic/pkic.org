import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  eventOccurrencesListQuerySchema,
  eventOccurrencesListResponseSchema,
  eventSeriesResponseSchema,
} from "../../assets/shared/schemas/event-series";
import { calendarDate } from "../../assets/ts/components/calendar-range";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const groupId = "20000000-0000-4000-8000-000000000003";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test("a meeting calendar uses bounded dates and opens a dedicated occurrence record", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-meeting-calendar"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const timezone = "Europe/Amsterdam";
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const response = await page.request.post(`/api/v1/groups/${groupId}/meetings/series`, {
    data: {
      eventName: `Architecture review ${unique}`,
      eventSlug: `e2e-calendar-${unique}`,
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt,
      recurrenceRule: "FREQ=DAILY;COUNT=12",
      timezone,
      durationMinutes: 60,
      location: "Consortium meeting room",
      providerType: null,
    },
  });
  expect(response.status()).toBe(201);
  const { series } = eventSeriesResponseSchema.parse(await response.json());
  const endpoint = `/api/v1/groups/${groupId}/meetings/series/${series.id}/occurrences`;
  const path = `/portal/#/groups/${groupId}/meetings/${series.id}/occurrences`;
  await page.goto(path);
  await expect(page.getByRole("table")).toBeVisible();
  const calendarResponse = page.waitForResponse(
    (item) => new URL(item.url()).pathname === endpoint && new URL(item.url()).searchParams.has("overlapsFrom"),
  );
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const loaded = await calendarResponse;
  expect(loaded.status()).toBe(200);
  const query = eventOccurrencesListQuerySchema.parse(Object.fromEntries(new URL(loaded.url()).searchParams));
  expect(query.limit).toBe(50);
  expect(query.offset).toBe(0);
  expect(query.overlapsFrom).toBeTruthy();
  expect(query.overlapsTo).toBeTruthy();
  const collection = eventOccurrencesListResponseSchema.parse(await loaded.json());
  expect(collection.occurrences.length).toBeLessThanOrEqual(query.limit);
  for (const occurrence of collection.occurrences) {
    expect(occurrence.endsAt > query.overlapsFrom!).toBe(true);
    expect(occurrence.startsAt < query.overlapsTo!).toBe(true);
  }
  const calendar = page.getByRole("region", { name: "Meeting calendar", exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar.locator("form")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(calendar.getByText(timezone, { exact: false }).first()).toBeVisible();
  if (calendarDate(new Date(startsAt), timezone).slice(0, 7) !== calendarDate(new Date(), timezone).slice(0, 7)) {
    await calendar.getByRole("button", { name: "Next month", exact: true }).click();
  }
  await expect(calendar.locator(".pk-calendar__entry").first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${artifacts}/meeting-calendar-month-desktop.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${artifacts}/meeting-calendar-month-desktop-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const name of ["Previous month", "Today", "Next month", "Month", "Week"]) {
    const control = calendar.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    await control.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        control.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const panel = element.closest(".pk-panel")!.getBoundingClientRect();
          return (
            bounds.width > 0 &&
            bounds.left >= Math.max(0, panel.left) &&
            bounds.right <= Math.min(window.innerWidth, panel.right) &&
            bounds.top >= 0 &&
            bounds.bottom <= window.innerHeight
          );
        }),
      )
      .toBe(true);
  }
  await page.screenshot({ path: `${artifacts}/meeting-calendar-month-phone.png`, fullPage: true });
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  await expect(calendar.locator(".pk-calendar__day")).toHaveCount(7);
  await expect(calendar.locator("form")).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/meeting-calendar-week-phone.png`, fullPage: true });
  await calendar.getByRole("button", { name: "Month", exact: true }).click();
  const entry = calendar.locator(".pk-calendar__entry").first();
  await expect(entry).toBeVisible();
  const destination = await entry.getAttribute("href");
  expect(destination).toContain(`/meetings/${series.id}/occurrences/`);
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/meetings/${series.id}/occurrences/[0-9a-f-]+$`));
  const settings = page.getByRole("region", { name: "Occurrence settings", exact: true });
  await expect(settings).toHaveCount(1);
  await expect(settings).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/meeting-calendar-occurrence-record-phone.png`, fullPage: true });
});
