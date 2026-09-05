/**
 * @covers event.3.3
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { openRow } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

type ApiResult = { status: number; body: unknown };

async function api(page: Page, path: string, method: string, body?: unknown): Promise<ApiResult> {
  return page.evaluate(
    async ({ path: requestPath, method: requestMethod, body: requestBody }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "same-origin",
        headers: requestBody === undefined ? undefined : { "content-type": "application/json" },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { path, method, body },
  );
}

function expectStatus(result: ApiResult, status: number): Record<string, unknown> {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body as Record<string, unknown>;
}

async function createConfiguredEvent(page: Page, unique: string): Promise<{ id: string; slug: string; name: string }> {
  const slug = `portal-attendee-management-${unique}`;
  const name = `Portal attendee management ${unique}`;
  const base = `/api/v1/groups/${GROUP_ID}/events`;
  const created = expectStatus(
    await api(page, base, "POST", {
      slug,
      name,
      timezone: "Europe/Amsterdam",
      startsAt: "2027-07-10T07:00:00.000Z",
      endsAt: "2027-07-10T15:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      location: "E2E venue",
      links: [],
    }),
    201,
  );
  const event = created.event as { id: string; updatedAt: string };
  expect(event.id).toBeTruthy();

  const terms = expectStatus(
    await api(page, `${base}/${event.id}/terms`, "PUT", {
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        attendee: [{ termKey: "e2e-terms", version: "1.0", required: true, displayText: "I agree to the E2E terms" }],
        speaker: [],
        presentation: [],
      },
    }),
    200,
  );
  const termsUpdatedAt = terms.eventUpdatedAt as string;

  const settings = expectStatus(
    await api(page, `${base}/${event.id}/registration-settings`, "PUT", {
      expectedUpdatedAt: termsUpdatedAt,
      registrationPolicy: "public",
    }),
    200,
  );
  const settingsUpdatedAt = settings.eventUpdatedAt as string;
  expectStatus(
    await api(page, `${base}/${event.id}/days`, "PUT", {
      expectedUpdatedAt: settingsUpdatedAt,
      configuration: {
        days: [
          {
            date: "2027-07-10",
            label: "E2E Saturday",
            startTime: "09:00",
            endTime: "17:00",
            sortOrder: 10,
            attendanceOptions: [
              { value: "in_person", label: "In person", capacity: 10 },
              { value: "virtual", label: "Virtual", capacity: null },
            ],
          },
        ],
      },
    }),
    200,
  );

  return { id: event.id, slug, name };
}

test("a selected-group manager changes one attendee day through portal routes", async ({ page }) => {
  const adminRequests: string[] = [];
  const groupRegistrationRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) adminRequests.push(`${request.method()} ${pathname}`);
    if (pathname.includes(`/api/v1/groups/${GROUP_ID}/events/`) && pathname.includes("/registrations")) {
      groupRegistrationRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-event-attendee-management"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const event = await createConfiguredEvent(page, unique);
  const attendeeEmail = `portal-attendee-${unique}@pkic.org`;
  const confirmationSince = await capturedEmailCount();

  const registration = expectStatus(
    await api(page, `/api/v1/events/${event.slug}/registrations`, "POST", {
      firstName: "E2E",
      lastName: "Attendee",
      email: attendeeEmail,
      organizationName: "E2E Organization",
      jobTitle: "Test attendee",
      dayAttendance: [{ dayDate: "2027-07-10", attendanceType: "in_person" }],
      consents: [{ termKey: "e2e-terms", version: "1.0" }],
    }),
    200,
  );
  expect(registration.status).toBe("pending_email_confirmation");
  const confirmation = await waitForCapturedEmail(attendeeEmail, "Confirm your registration", {
    since: confirmationSince,
  });
  const confirmationUrl = new URL(extractEmailUrl(confirmation, "/register/confirm/"));
  const confirmed = expectStatus(
    await api(
      page,
      `/api/v1/events/${event.slug}/registrations/confirm-email?${confirmationUrl.searchParams.toString()}`,
      "GET",
    ),
    200,
  );
  expect(confirmed.status).toBe("registered");

  await page.goto(`/portal/#/groups/${GROUP_ID}/events`);
  await page.getByPlaceholder("Search events…").fill(event.slug);
  const row = page.getByRole("row").filter({ hasText: event.name });
  await expect(row).toBeVisible();
  await openRow(row, `Open ${event.name}`);
  const detail = page.getByRole("region", { name: `${event.name} workspace` });
  await tab(detail, "Registrations").click();
  await expect(detail.getByRole("region", { name: "Registrations", exact: true })).toBeVisible();

  const attendeeRow = detail.getByRole("row").filter({ hasText: attendeeEmail });
  await expect(attendeeRow).toBeVisible();
  await attendeeRow.getByRole("button", { name: "Manage attendance" }).click();
  const attendance = page.getByRole("region", { name: "Attendance for E2E Attendee" });
  await expect(attendance).toBeVisible();
  await expect(attendance.getByLabel("Attendance for 2027-07-10")).toHaveValue("in_person");
  // The waitlist state is read from the day's own row rather than from
  // anywhere in the panel, and it is the badge's word — the raw status token
  // is no longer what the cell renders.
  const attendanceDay = attendance.getByRole("row").filter({ hasText: "2027-07-10" });
  await expect(attendanceDay.getByText("—", { exact: true })).toBeVisible();

  await attendance.getByRole("button", { name: "Return to waitlist" }).click();
  await expect(attendanceDay.getByText("Waiting", { exact: true })).toBeVisible();
  // Several live regions share the page — the selection counter, the panel's
  // own outcome alert, the toast — so each assertion names the one it means.
  await expect(page.getByRole("status").filter({ hasText: "updated" })).toBeVisible();

  await attendance.getByLabel("Admit day").check();
  await attendance.getByRole("button", { name: "Admit selected days" }).click();
  await expect(attendanceDay.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(attendance.getByLabel("Attendance for 2027-07-10")).toHaveValue("in_person");
  await expect(page.getByRole("status").filter({ hasText: "admitted" })).toBeVisible();

  const vipOverride = attendance.getByRole("region", { name: "Reasoned VIP admission override" });
  await expect(vipOverride).toContainText("Requires the effective event manage capability");
  await vipOverride.getByLabel("E2E Saturday — 2027-07-10").check();
  await vipOverride.getByLabel("Required reason").fill("E2E invited consortium guest");
  const vipResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/api\/v1\/groups\/[^/]+\/events\/[^/]+\/registrations\/[^/]+\/admissions$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await vipOverride.getByRole("button", { name: "Apply VIP override" }).click();
  expect((await vipResponse).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "VIP override applied" })).toBeVisible();

  expect(adminRequests, "portal attendee management must not call admin APIs").toEqual([]);
  expect(groupRegistrationRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/registrations$/),
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/registrations\/.*$/),
      expect.stringMatching(/^PATCH \/api\/v1\/groups\/.*\/events\/.*\/registrations\/.*\/day-attendance$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/events\/.*\/registrations\/.*\/admissions$/),
    ]),
  );
});
