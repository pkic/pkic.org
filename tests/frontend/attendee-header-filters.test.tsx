// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";
import { formatDayAndMonth } from "../../assets/shared/format-date";
import { eventAttendanceRegistrationsQuerySchema } from "../../assets/shared/schemas/event-registrations";
import { groupEventDaysResponseSchema } from "../../assets/shared/schemas/group-events";
import { groupEventRegistrationExportQuerySchema } from "../../assets/shared/schemas/group-event-registration-operations";
import { eventBadgePrintPopulationQuerySchema } from "../../assets/shared/schemas/event-badge-printing";
import { openColumnFilterMenu, chooseColumnFilter } from "./helpers/column-menu";
import { GROUP_ID, EVENT_ID, json, registrationList } from "./helpers/group-event-attendance-fixtures";

let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (host) {
    await act(async () => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function setup(status = "registered", dayCount = 2) {
  const queries: Array<ReturnType<typeof eventAttendanceRegistrationsQuerySchema.parse>> = [];
  const print = vi.fn();
  const days = groupEventDaysResponseSchema.parse({
    eventUpdatedAt: "2026-08-01T00:00:00.000Z",
    days: Array.from({ length: dayCount }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`).map((date, i) => ({
      id: `day-${i}`,
      date,
      label: `Day ${i + 1}`,
      startsAt: null,
      endsAt: null,
      sortOrder: i,
      attendanceOptions: [
        { value: "in_person", label: "At the venue", accessMode: "physical", enabled: true },
        { value: "virtual", label: "Online", accessMode: "remote", enabled: true },
      ],
      attendanceCounts: {},
    })),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname.endsWith("/days")) return json(days);
      queries.push(eventAttendanceRegistrationsQuerySchema.parse(Object.fromEntries(url.searchParams)));
      const list = registrationList();
      return json({
        ...list,
        registrations: list.registrations.map((row) => ({
          ...row,
          status,
          ...(dayCount > 2
            ? {
                days: days.days.map((day) => ({
                  dayDate: day.date,
                  label: day.label,
                  attendanceType: "in_person",
                  waitlistStatus: null,
                })),
              }
            : {}),
        })),
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () =>
    render(
      <GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} eventSlug="workshop" canManage onPrint={print} />,
      host!,
    ),
  );
  await settle();
  return { container: host, queries, print };
}
async function dayChoice(container: HTMLElement, name: string) {
  const popup = openColumnFilterMenu(container, "Attendance", "Days");
  const choice = [
    ...popup.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"], [role="menuitemradio"]'),
  ].find((button) => button.textContent?.replace(/^✓/, "").trim() === name);
  expect(choice).toBeDefined();
  await act(async () => choice!.click());
  await settle();
}
it("sends multi-day matching, attendance and waitlist from headers into the list, print and CSV scopes", async () => {
  const { container, queries, print } = await setup();
  await dayChoice(container, formatDayAndMonth("2026-09-01"));
  await dayChoice(container, formatDayAndMonth("2026-09-02"));
  await dayChoice(container, "All selected days");
  await chooseColumnFilter(container, "Attendance", "At the venue", "Attendance type");
  await chooseColumnFilter(container, "Attendance", "Not waitlisted", "Waitlist");
  await settle();
  const expected = {
    day_dates: "2026-09-01,2026-09-02",
    day_match: "all",
    attendance_type: "in_person",
    waitlisted: "false",
  };
  expect(queries.at(-1)).toMatchObject(expected);
  expect(location.hash).toContain("registrations.f.day_dates");
  const download = container.querySelector<HTMLAnchorElement>('a[aria-label="Download matching attendee list (CSV)"]')!;
  expect(
    groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(download.href).searchParams)),
  ).toMatchObject(expected);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Registration actions"]')!.click(),
  );
  const action = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes("Print matching"),
  )!;
  await act(async () => action.click());
  const scope = print.mock.calls.at(-1)![0];
  expect(scope.kind).toBe("filtered");
  expect(eventBadgePrintPopulationQuerySchema.parse(scope.filters)).toMatchObject(expected);
});
it("clears a selected attendee when a header filter changes, preventing an old selection reaching exports", async () => {
  const { container } = await setup();
  const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select Group Member"]')!;
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox.click());
  await settle();
  const selected = container.querySelector<HTMLAnchorElement>('a[aria-label="Download selected attendee list (CSV)"]')!;
  const selectedScope = groupEventRegistrationExportQuerySchema.parse(
    Object.fromEntries(new URL(selected.href).searchParams),
  );
  expect(selectedScope.ids).toEqual([registrationList().registrations[0]!.id]);
  await dayChoice(container, formatDayAndMonth("2026-09-01"));
  expect(container.querySelector('a[aria-label="Download selected attendee list (CSV)"]')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Select Group Member"]')?.checked).toBe(false);
});
it("removes one selected day without clearing another and resets all days explicitly", async () => {
  const { container, queries } = await setup();
  await dayChoice(container, formatDayAndMonth("2026-09-01"));
  await dayChoice(container, formatDayAndMonth("2026-09-02"));
  await dayChoice(container, formatDayAndMonth("2026-09-01"));
  expect(queries.at(-1)?.day_dates).toBe("2026-09-02");
  await dayChoice(container, "All days");
  expect(queries.at(-1)?.day_dates).toBeUndefined();
});

it("allows a selected cancelled registration into printing and CSV without changing its status", async () => {
  const { container, print } = await setup("cancelled");
  await chooseColumnFilter(container, "Status", "Cancelled");
  await settle();
  await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Select Group Member"]')!.click());
  await settle();
  const action = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Print selected badges"),
  )!;
  expect(action.disabled).toBe(false);
  await act(async () => action.click());
  expect(print.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "selected", rows: [{ status: "cancelled" }] });
  const csv = container.querySelector<HTMLAnchorElement>('a[aria-label="Download selected attendee list (CSV)"]')!;
  expect(
    groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(csv.href).searchParams)),
  ).toMatchObject({ status: "cancelled", ids: [registrationList().registrations[0]!.id] });
});

it("supports seven individually selected days without expanding every row into a date list", async () => {
  const { container, queries } = await setup("registered", 7);
  const summary = container.querySelector('[role="img"][aria-label^="At the venue: 7 days total"]');
  expect(summary).not.toBeNull();
  expect(summary?.getAttribute("title")).toContain(formatDayAndMonth("2026-09-07"));
  for (let day = 1; day <= 7; day++)
    await dayChoice(container, formatDayAndMonth(`2026-09-${String(day).padStart(2, "0")}`));
  await dayChoice(container, "All selected days");
  expect(queries.at(-1)?.day_dates?.split(",")).toHaveLength(7);
  expect(queries.at(-1)?.day_match).toBe("all");
});
