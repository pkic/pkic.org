// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { DataTable } from "../../assets/ts/components/Table";
import { registrationAttendanceColumns } from "../../assets/ts/components/event-registrations/registration-attendance-columns";
import type { RegistrationDayState } from "../../assets/shared/schemas/event-registrations";
import { formatDayAndMonth } from "../../assets/shared/format-date";

const days = Array.from({ length: 7 }, (_, i) => ({
  date: `2026-12-0${i + 1}`,
  label: null,
  attendanceOptions: [
    { value: "in_person", label: "In person", accessMode: "physical" as const, enabled: true },
    { value: "virtual", label: "Online", accessMode: "remote" as const, enabled: true },
  ],
}));
const row: { days: RegistrationDayState[] } = {
  days: days.map((day, i) => ({
    dayDate: day.date,
    label: null,
    attendanceType: i === 5 ? "virtual" : "in_person",
    waitlistStatus: i === 6 ? "waiting" : null,
  })),
};
let host: HTMLDivElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
});
function mount(filters: Record<string, string>, registration = row) {
  host = document.createElement("div");
  document.body.append(host);
  void act(() =>
    render(
      <DataTable
        caption="Attendance"
        columns={registrationAttendanceColumns(days, filters)}
        data={[registration]}
        rowKey={() => "person"}
      />,
      host!,
    ),
  );
  return host;
}
it("shows one count per attendance type with an exact proportional fill", () => {
  const view = mount({});
  const badges = view.querySelectorAll('[role="img"]');
  expect(badges).toHaveLength(2);
  expect(badges[0]?.getAttribute("aria-label")).toContain(
    "In person: 6 days total; 5 not waitlisted; 1 of these is waitlisted",
  );
  expect(badges[0]?.textContent).toBe("6");
  expect(
    parseFloat(badges[0]?.querySelector(".pk-badge__fill > rect:last-of-type")?.getAttribute("width") ?? ""),
  ).toBeCloseTo(100 / 6);
  const stripe = badges[0]?.querySelector("pattern")?.id;
  expect(badges[0]?.querySelector(".pk-badge__fill > rect:last-of-type")?.getAttribute("fill")).toBe(`url(#${stripe})`);
  expect(stripe).not.toBe(badges[1]?.querySelector("pattern")?.id);
  expect(parseFloat(badges[0]?.querySelector("rect")?.getAttribute("width") ?? "")).toBeCloseTo((100 * 5) / 6);
  expect(badges[1]?.querySelector("rect")?.getAttribute("width")).toBe("100%");
  expect(badges[1]?.getAttribute("aria-label")).toContain("Online: 1 day total");
  expect(badges[0]?.getAttribute("data-color")).not.toBe(badges[1]?.getAttribute("data-color"));
  expect(view.querySelector(".pk-badge-group")).not.toBeNull();
  expect(view.querySelectorAll("thead th")).toHaveLength(1);
});
it("counts only matching in-person days when date, type and waitlist filters are combined", () => {
  const view = mount({
    attendance_type: "in_person",
    day_dates: days.map((day) => day.date).join(","),
    waitlisted: "false",
  });
  const badge = view.querySelector('[role="img"]')!;
  expect(view.querySelectorAll('[role="img"]')).toHaveLength(1);
  expect(badge.textContent).toBe("5");
  expect(badge.getAttribute("aria-label")).toContain("In person: 5 days total");
  expect(badge.getAttribute("title")).toContain(formatDayAndMonth("2026-12-05"));
  expect(badge.getAttribute("title")).not.toContain(formatDayAndMonth("2026-12-07"));
  expect(badge.querySelector(".pk-badge__fill rect")?.getAttribute("width")).toBe("100%");
});
it("shows a completely light fill for the selected waiting day", () => {
  const view = mount({ attendance_type: "in_person", day_dates: "2026-12-07", waitlisted: "true" });
  const badge = view.querySelector('[role="img"]')!;
  expect(badge.textContent).toBe("1");
  expect(badge.getAttribute("aria-label")).toContain("1 day total; 0 not waitlisted; 1 of these is waitlisted");
  expect(badge.getAttribute("title")).toContain(`${formatDayAndMonth("2026-12-07")} (waiting)`);
  expect(badge.querySelector(".pk-badge__fill rect")?.getAttribute("width")).toBe("0%");
  expect(badge.querySelector(".pk-badge__fill > rect:last-of-type")?.getAttribute("width")).toBe("100%");
});

it("keeps one count and zero dark fill when all seven days are waiting or offered", () => {
  const view = mount(
    {},
    {
      days: row.days.map((day, index) => ({
        ...day,
        attendanceType: "in_person",
        waitlistStatus: index === 0 ? "offered" : "waiting",
      })),
    },
  );
  const badge = view.querySelector('[role="img"]')!;
  expect(badge.textContent).toBe("7");
  expect(badge.getAttribute("aria-label")).toContain("7 days total; 0 not waitlisted; 7 of these are waitlisted");
  expect(badge.querySelector(".pk-badge__fill rect")?.getAttribute("width")).toBe("0%");
  expect(badge.querySelector(".pk-badge__fill > rect:last-of-type")?.getAttribute("width")).toBe("100%");
});

it("offers day filters chronologically even when configuration arrives in another order", () => {
  const column = registrationAttendanceColumns([...days].reverse())[0]!;
  expect(
    column.filters?.find((filter) => filter.param === "day_dates")?.options?.map((option) => option.value),
  ).toEqual(["", ...days.map((day) => day.date)]);
});
