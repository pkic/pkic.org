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
      <GroupEventRegistrations
        groupId={GROUP_ID}
        eventId={EVENT_ID}
        eventSlug="workshop"
        badgesPath={`/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/badges`}
        canManage
        onPrint={print}
      />,
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
  const download = container.querySelector<HTMLAnchorElement>('a[aria-label="Download matching attendee data (CSV)"]')!;
  expect(
    groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(download.href).searchParams)),
  ).toMatchObject(expected);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Print matching attendees"]')!.click(),
  );
  const action = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === "Print labels",
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
  const selected = container.querySelector<HTMLAnchorElement>(
    '.pk-bulk-bar a[aria-label="Download selected attendee data (CSV)"]',
  )!;
  const selectedScope = groupEventRegistrationExportQuerySchema.parse(
    Object.fromEntries(new URL(selected.href).searchParams),
  );
  expect(selectedScope.ids).toEqual([registrationList().registrations[0]!.id]);
  await dayChoice(container, formatDayAndMonth("2026-09-01"));
  expect(container.querySelector('.pk-bulk-bar a[aria-label="Download selected attendee data (CSV)"]')).toBeNull();
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
  const trigger = container.querySelector<HTMLButtonElement>(
    '.pk-bulk-bar button[aria-label="Print selected attendees"]',
  )!;
  await act(async () => trigger.click());
  const action = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.trim() === "Print labels",
  )!;
  expect(action.disabled).toBe(false);
  await act(async () => action.click());
  expect(print.mock.calls.at(-1)?.[0]).toMatchObject({ kind: "selected", rows: [{ status: "cancelled" }] });
  const csv = container.querySelector<HTMLAnchorElement>(
    '.pk-bulk-bar a[aria-label="Download selected attendee data (CSV)"]',
  )!;
  expect(
    groupEventRegistrationExportQuerySchema.parse(Object.fromEntries(new URL(csv.href).searchParams)),
  ).toMatchObject({ status: "cancelled", ids: [registrationList().registrations[0]!.id] });
});

it("supports seven individually selected days without expanding every row into a date list", async () => {
  const { container, queries } = await setup("registered", 7);
  const summary = container.querySelector('[role="img"][aria-label^="At the venue: 7 days total"]');
  expect(summary).not.toBeNull();
  expect(summary?.getAttribute("aria-label")).toContain(formatDayAndMonth("2026-09-07"));
  for (let day = 1; day <= 7; day++)
    await dayChoice(container, formatDayAndMonth(`2026-09-${String(day).padStart(2, "0")}`));
  await dayChoice(container, "All selected days");
  expect(queries.at(-1)?.day_dates?.split(",")).toHaveLength(7);
  expect(queries.at(-1)?.day_match).toBe("all");
});

it("offers country, job title and attendee type filters without revealing their columns", async () => {
  const { container, queries, print } = await setup();
  async function menu(label: string) {
    const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')].find(
      (button) => button.textContent?.trim().startsWith(label),
    );
    expect(item, label).toBeDefined();
    await act(() => item!.click());
  }
  async function open() {
    await act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Sort and filter registrations"]')!.click(),
    );
  }
  await open();
  await menu("Filter by Attendee type");
  await menu("Staff");
  await settle();
  expect(queries.at(-1)?.badge_role).toBe("staff");
  await open();
  await menu("Filter by Country");
  await menu("Netherlands");
  await settle();
  expect(queries.at(-1)?.country).toBe("NL");
  await open();
  await menu("Filter by Job title");
  const input = container.querySelector<HTMLInputElement>('input[placeholder="e.g. security architect"]')!;
  await act(() => {
    input.value = "architect";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(queries.at(-1)?.job_title).toBe("architect"));
  const headers = [...container.querySelectorAll("thead th")].map((cell) => cell.textContent);
  expect(headers).not.toContain("Country");
  expect(headers).not.toContain("Job title");
  expect(headers).not.toContain("Attendee type");
  await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Print matching attendees"]')!.click());
  await menu("Download label CSV");
  expect(print.mock.calls.at(-1)?.[1]).toBe("label_csv");
  expect(print.mock.calls.at(-1)?.[0]).toMatchObject({
    kind: "filtered",
    filters: { country: "NL", job_title: "architect", badge_role: "staff" },
  });
});

it("keeps row printing in the ellipsis menu and starts the chosen output directly", async () => {
  const { container, print } = await setup();
  const trigger = () => container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Group Member"]')!;
  expect(container.querySelector('tbody button[title="Print label"], tbody button[title="Print badge"]')).toBeNull();
  for (const [label, action] of [
    ["Print label", "labels"],
    ["Print badge", "badges"],
  ] as const) {
    await act(() => trigger().click());
    const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === label,
    )!;
    expect(item).toBeDefined();
    await act(() => item.click());
    expect(print.mock.calls.at(-1)?.[1]).toBe(action);
    expect(print.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: "selected",
      rows: [{ id: registrationList().registrations[0]!.id }],
    });
  }
});
