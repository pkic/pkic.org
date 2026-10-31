// @vitest-environment jsdom
import { render, type ComponentChild } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventDayReadModelSchema, type EventDayReadModel } from "../../assets/shared/schemas/event-read-models";
import { ATTENDANCE_WAITLIST_COPY, DayAttendancePicker } from "../../assets/ts/components/DayAttendancePicker";
import { readDayAttendance, readDayAttendanceChoices } from "../../assets/ts/shared/widgets/day-attendance";
import { axeViolations } from "./helpers/axe";

function day(overrides: Record<string, unknown> = {}): EventDayReadModel {
  return eventDayReadModelSchema.parse({
    dayDate: "2027-09-01",
    label: "Day one",
    inPersonCapacity: 100,
    sortOrder: 1,
    attendanceOptions: [
      { value: "in_person", label: "In person", spotsRemainingPercent: 50 },
      { value: "virtual", label: "Virtual" },
    ],
    ...overrides,
  });
}
let host: HTMLDivElement;
function mount(node: ComponentChild): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  void act(() => render(<form>{node}</form>, host));
  return host;
}
afterEach(async () => {
  if (host) {
    await act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
});
function input(root: ParentNode, date: string, value: string): HTMLInputElement {
  return root.querySelector<HTMLInputElement>(`input[name="dayAttendance.${date}"][value="${value}"]`)!;
}
async function click(control: HTMLElement) {
  await act(() => control.click());
}

describe("day attendance matrix", () => {
  it("names the table and every native day choice, with the whole label as its target", async () => {
    const picker = mount(<DayAttendancePicker days={[day(), day({ dayDate: "2027-09-02", label: "Day two" })]} />);
    expect(picker.querySelector("caption")?.textContent).toBe("Attendance by day");
    expect(picker.querySelectorAll("th[scope=col]")).toHaveLength(3);
    for (const radio of picker.querySelectorAll<HTMLInputElement>("input[type=radio]")) {
      expect(radio.labels?.[0]?.contains(radio)).toBe(true);
      expect(radio.labels?.[0]?.textContent).toContain(radio.dataset.dayLabel);
      expect(radio.required).toBe(false);
    }
    expect(picker.querySelectorAll('input[name="dayAttendance.2027-09-01"]')).toHaveLength(3);
    expect(await axeViolations(picker)).toEqual([]);
  });
  it("changes just the chosen day and clears it through Not attending", async () => {
    const picker = mount(<DayAttendancePicker days={[day(), day({ dayDate: "2027-09-02" })]} />);
    const form = picker.querySelector("form")!;
    expect(readDayAttendanceChoices(form).map((day) => day.answered)).toEqual([false, false]);
    await click(input(picker, "2027-09-01", "virtual"));
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([
      { dayDate: "2027-09-01", attendanceType: "virtual" },
    ]);
    await click(input(picker, "2027-09-01", ""));
    expect(readDayAttendance(form)).toEqual([]);
    expect(
      readDayAttendanceChoices(form).map((day) => ({ answered: day.answered, value: day.attendanceType })),
    ).toEqual([
      { answered: true, value: "" },
      { answered: false, value: "" },
    ]);
  });
  it("applies a row to every offered day and preserves the choice on an unavailable day", async () => {
    const days = [
      day({
        attendanceOptions: [
          { value: "lounge", label: "Lounge" },
          { value: "virtual", label: "Virtual" },
        ],
      }),
      day({ dayDate: "2027-09-02", attendanceOptions: [{ value: "virtual", label: "Virtual" }] }),
      day({ dayDate: "2027-09-03", attendanceOptions: [{ value: "lounge", label: "Lounge" }] }),
    ];
    function Controlled() {
      const [value, setValue] = useState<Record<string, string>>({ "2027-09-02": "virtual" });
      return (
        <DayAttendancePicker
          days={days}
          value={value}
          onChange={(date, type) => setValue((current) => ({ ...current, [date]: type }))}
        />
      );
    }
    const picker = mount(<Controlled />);
    expect(picker.querySelector(".pk-attendance-matrix__unavailable")?.textContent).toContain("Not offered");
    await click(picker.querySelector<HTMLButtonElement>('[aria-label="Choose Lounge for every available day"]')!);
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([
      { dayDate: "2027-09-01", attendanceType: "lounge" },
      { dayDate: "2027-09-02", attendanceType: "virtual" },
      { dayDate: "2027-09-03", attendanceType: "lounge" },
    ]);
    await click(
      picker.querySelector<HTMLButtonElement>('[aria-label="Choose Not attending for every available day"]')!,
    );
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([]);
  });
  it("explains the waitlist for its exact day and shows a warning only after selection", async () => {
    const picker = mount(
      <DayAttendancePicker
        days={[
          day({ attendanceOptions: [{ value: "in_person", label: "In person", spotsRemainingPercent: 0 }] }),
          day({ dayDate: "2027-09-02", label: "Day two" }),
        ]}
      />,
    );
    const full = input(picker, "2027-09-01", "in_person");
    expect(document.getElementById(full.getAttribute("aria-describedby")!)?.textContent).toBe(
      ATTENDANCE_WAITLIST_COPY.line("In person"),
    );
    expect(picker.querySelector('[role="alert"]')).toBeNull();
    await click(full);
    expect(picker.querySelector('[role="alert"]')?.textContent).toContain("Waitlist: Wednesday");
    expect(picker.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(full.closest("label")?.textContent).toContain("joins waitlist");
    await click(input(picker, "2027-09-01", ""));
    expect(picker.querySelector('[role="alert"]')).toBeNull();
  });
  it.each([
    [2, "Full on Wednesday and Thursday"],
    [3, "Full on all days"],
  ] as const)("summarizes %s full days without duplicating warning panels", async (count, summary) => {
    const days = Array.from({ length: 3 }, (_, index) =>
      day({
        dayDate: `2027-09-0${index + 1}`,
        label: `Day ${index + 1}`,
        attendanceOptions: [
          { value: "in_person", label: "In person", spotsRemainingPercent: index < count ? 0 : 50 },
          { value: "virtual", label: "Virtual" },
        ],
      }),
    );
    const picker = mount(<DayAttendancePicker days={days} />);
    expect(picker.querySelector(".pk-attendance-matrix__full")?.textContent).toBe(summary);
    await click(picker.querySelector<HTMLButtonElement>('[aria-label="Choose In person for every available day"]')!);
    expect(picker.querySelectorAll('[role="alert"]')).toHaveLength(1);
    for (let index = 0; index < count; index++)
      expect(picker.querySelector('[role="alert"]')?.textContent).toContain(["Wed", "Thu", "Fri"][index]);
    if (count === 2) expect(picker.querySelector('[role="alert"]')?.textContent).not.toContain("Fri");
    expect(readDayAttendance(picker.querySelector("form")!)).toHaveLength(3);
  });
  it("shows configured descriptions and named capacity feedback", () => {
    const picker = mount(
      <DayAttendancePicker
        days={[
          day({
            attendanceOptions: [
              { value: "in_person", label: "In person", description: "At the venue", spotsRemainingPercent: 10 },
            ],
          }),
        ]}
        lowCapacityThreshold={20}
      />,
    );
    expect(picker.textContent).toContain("At the venue");
    expect(
      input(picker, "2027-09-01", "in_person").labels?.[0]?.querySelector('[aria-label="Limited spots remaining"]')
        ?.textContent,
    ).toBe("Few left");
  });
  it("uses configured icons without a misleading fallback on a custom option", () => {
    const picker = mount(
      <DayAttendancePicker
        days={[
          day({
            attendanceOptions: [
              { value: "lounge", label: "Lounge", icon: "video" },
              { value: "virtual", label: "Virtual" },
              { value: "workshop", label: "Workshop" },
              { value: "in_person", label: "In person", icon: "none" },
            ],
          }),
        ]}
      />,
    );
    const methods = picker.querySelectorAll(".pk-attendance-matrix__method");
    expect(methods[0].querySelector("svg")?.outerHTML).toBe(methods[1].querySelector("svg")?.outerHTML);
    expect(methods[0].querySelector("svg")).not.toBeNull();
    expect(methods[2].querySelector("svg")).toBeNull();
    expect(methods[3].querySelector("svg")).toBeNull();
  });
  it("falls back to the calendar date for a day with no label", () => {
    const picker = mount(<DayAttendancePicker days={[day({ label: null })]} />);
    expect(input(picker, "2027-09-01", "virtual").labels?.[0]?.textContent).toContain("2027-09-01");
  });
  it("keeps the same choices when a longer phone schedule turns between orientations", async () => {
    let phone = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return phone;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    const days = Array.from({ length: 7 }, (_, index) =>
      day({ dayDate: `2027-09-0${index + 1}`, label: `Day ${index + 1}` }),
    );
    const picker = mount(<DayAttendancePicker days={days} />);
    expect(picker.querySelector("thead .pk-attendance-matrix__date strong")?.textContent).toBe("Wednesday");
    expect(picker.querySelector("thead .pk-attendance-matrix__date")?.textContent).toContain("2027");
    await click(picker.querySelector<HTMLButtonElement>('[aria-label="Choose Virtual for every available day"]')!);
    expect(readDayAttendance(picker.querySelector("form")!)).toHaveLength(7);
    await act(() => {
      phone = true;
      for (const listener of listeners) listener();
    });
    expect(picker.querySelector('[data-transposed="true"]')).not.toBeNull();
    expect(picker.querySelector("tbody .pk-attendance-matrix__date strong")?.textContent).toBe("Wed");
    expect(await axeViolations(picker)).toEqual([]);
    expect(picker.querySelectorAll("th")).toHaveLength(4);
    expect(readDayAttendance(picker.querySelector("form")!)).toHaveLength(7);
    await click(
      picker.querySelector<HTMLButtonElement>('thead [aria-label="Choose Not attending for every available day"]')!,
    );
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([]);
    await click(input(picker, "2027-09-03", "virtual"));
    await act(() => {
      phone = false;
      for (const listener of listeners) listener();
    });
    expect(picker.querySelector("[data-transposed]")).toBeNull();
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([
      { dayDate: "2027-09-03", attendanceType: "virtual" },
    ]);
  });
  it("keeps authored option keys distinct from the built-in skip choice", async () => {
    const picker = mount(
      <DayAttendancePicker
        days={[
          day({
            attendanceOptions: [
              { value: "none", label: "Reception" },
              { value: "day", label: "Meeting" },
            ],
          }),
        ]}
      />,
    );
    const ids = [...picker.querySelectorAll<HTMLInputElement>("input[type=radio]")].map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);
    await click(picker.querySelector<HTMLButtonElement>('[aria-label="Choose Reception for every available day"]')!);
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([
      { dayDate: "2027-09-01", attendanceType: "none" },
    ]);
    await click(
      picker.querySelector<HTMLButtonElement>('[aria-label="Choose Not attending for every available day"]')!,
    );
    expect(readDayAttendance(picker.querySelector("form")!)).toEqual([]);
  });
  it("handles an empty event or a day without offered attendance methods", () => {
    const picker = mount(<DayAttendancePicker days={[]} />);
    expect(picker.textContent).toBe("No per-day attendance required for this event.");
    void act(() => render(<DayAttendancePicker days={[day({ attendanceOptions: [] })]} />, host));
    expect(host.querySelectorAll("input[type=radio]")).toHaveLength(1);
    expect(host.textContent).toContain("Not attending");
  });
});
