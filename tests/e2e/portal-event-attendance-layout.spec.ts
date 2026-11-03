import { expect, test } from "@playwright/test";
import { eventAnalyticsResponseSchema } from "../../assets/shared/schemas/event-analytics";
import { eventAnalyticsFixture } from "../helpers/event-analytics";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import { eventRegistrationsListResponseSchema } from "../../assets/shared/schemas/event-registrations";
import { groupEventDaysResponseSchema, groupEventDaysReplaceSchema } from "../../assets/shared/schemas/group-events";
import { signInToPortal } from "./helpers/portal-auth";

test("attendance charts fit their panels and keep labels readable", async ({ page }, testInfo) => {
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
    await page.goto(`/portal/#/events/${slug}/stats/registration-changes`);
    const where = page.getByRole("figure", { name: "Where attendance changed", exact: true });
    const how = page.getByRole("region", { name: "How attendance changed", exact: true });
    await expect(where).toBeVisible();
    await expect(how).toBeVisible();
    await expect(page.locator(".pk-table--data")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`attendance-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
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
    await page.screenshot({
      path: testInfo.outputPath(`analytics-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("waitlist admission refuses a full option and succeeds after a place opens", async ({ page, browser }, info) => {
  await signInToPortal(page, e2eAdminEmail("portal-waitlist-admission"));
  const fixture = await createRegistrationEvent(page, "waitlist-admission", {
    date: "2027-09-10",
    startTime: "09:00",
    endTime: "17:00",
    attendanceOptions: [{ value: "in_person", label: "In person", accessMode: "physical", capacity: 1 }],
  });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const attendee = await context.newPage();
    await registerStateAttendee(attendee, fixture, `holder-${crypto.randomUUID()}@synthetic-waitlist.test`, {
      staticRelease: false,
      organization: "Synthetic waitlist company",
    });
    const email = `waiting-${crypto.randomUUID()}@synthetic-waitlist.test`;
    await registerStateAttendee(attendee, fixture, email, {
      staticRelease: false,
      organization: "Synthetic waitlist company",
    });
    const roster = await page.request.get(`/api/v1/events/${fixture.slug}/registrations`, { params: { q: email } });
    expect(roster.status()).toBe(200);
    const registration = eventRegistrationsListResponseSchema.parse(await roster.json()).registrations[0]!;
    await page.goto(`/portal/#/events/${fixture.slug}/registrations/detail/${registration.id}`);
    const attendance = page.getByRole("table", { name: "Attendance by day", exact: true });
    await expect(attendance).toBeVisible();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await attendance.getByRole("button", { name: "Actions for Workshop day", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Admit from waitlist…", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`waitlist-menu-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
    }
    const admit = async (status: number) => {
      await attendance.getByRole("button", { name: "Actions for Workshop day", exact: true }).click();
      await page.getByRole("menuitem", { name: "Admit from waitlist…", exact: true }).click();
      const response = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(`/registrations/${registration.id}/admissions`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Admit from waitlist", exact: true }).click();
      expect((await response).status()).toBe(status);
    };
    await admit(409);
    await expect(page.getByRole("alert").filter({ hasText: /No place is free/ })).toBeVisible();
    await expect(attendance.getByText("Waiting", { exact: true })).toBeVisible();
    const daysUrl = `/api/v1/groups/${fixture.ownerGroupId}/events/${fixture.eventId}/days`;
    const days = groupEventDaysResponseSchema.parse(await (await page.request.get(daysUrl)).json());
    const changed = await page.request.put(daysUrl, {
      data: groupEventDaysReplaceSchema.parse({
        expectedUpdatedAt: days.eventUpdatedAt,
        configuration: {
          days: [
            {
              date: "2027-09-10",
              label: "Workshop day",
              startTime: "09:00",
              endTime: "17:00",
              sortOrder: 0,
              attendanceOptions: [{ value: "in_person", label: "In person", accessMode: "physical", capacity: 2 }],
            },
          ],
        },
      }),
    });
    expect(changed.status(), await changed.text()).toBe(200);
    await admit(200);
    await expect(attendance.getByText("Accepted", { exact: true })).toBeVisible();
    await page.reload();
    await expect(attendance.getByText("Accepted", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
