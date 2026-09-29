// @vitest-environment jsdom
/**
 * The per-day attendance choice on the registration and group-event forms.
 *
 * Each day is a set of radios sharing one `name`, so it is a group whether or
 * not the markup says so. The Bootstrap version wrote it as a `<div>` headed
 * by a paragraph, which meant a screen reader announced "In person, radio, 1
 * of 3" with nothing saying which day it belonged to — on an event with a card
 * per day. What is asserted here is the grouping, the `for`/`id` pair that
 * names each option, and the empty case.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { eventDayReadModelSchema, type EventDayReadModel } from "../../assets/shared/schemas/event-read-models";
import { DayAttendancePicker } from "../../assets/ts/components/DayAttendancePicker";
import { groupNames } from "./helpers/labelled-control";

/** Parsed through the shared read model, so a fixture cannot drift from it. */
function day(overrides: Record<string, unknown> = {}): EventDayReadModel {
  return eventDayReadModelSchema.parse({
    dayDate: "2026-10-03",
    label: "Day one",
    inPersonCapacity: 100,
    sortOrder: 1,
    attendanceOptions: [
      { value: "in_person", label: "In person", spotsRemainingPercent: 50 },
      { value: "virtual", label: "Virtual", spotsRemainingPercent: null },
    ],
    ...overrides,
  });
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("day attendance picker", () => {
  it("names every day's radios as a group, so an option says which day it belongs to", () => {
    const picker = mount(
      <DayAttendancePicker
        days={[day(), day({ dayDate: "2026-10-04", label: "Day two", sortOrder: 2 })]}
        lowCapacityThreshold={0}
      />,
    );

    expect(picker.querySelectorAll("fieldset")).toHaveLength(2);
    expect(groupNames(picker)).toEqual(["Day one", "Day two"]);
    // Every option is inside the group named after its day, not loose beside it.
    const firstGroup = picker.querySelector("fieldset")!;
    expect(firstGroup.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it("ties every option's label to its own control through for/id", () => {
    const picker = mount(<DayAttendancePicker days={[day()]} />);

    for (const label of picker.querySelectorAll("label")) {
      const control = picker.querySelector(`[id="${label.htmlFor}"]`);
      expect(control).not.toBeNull();
      expect((control as HTMLInputElement).type).toBe("radio");
    }
    expect(
      [...picker.querySelectorAll('input[type="radio"]')].map((input) => (input as HTMLInputElement).name),
    ).toEqual(["dayAttendance.2026-10-03", "dayAttendance.2026-10-03"]);
  });

  it("falls back to the calendar date when a day carries no label of its own", () => {
    const picker = mount(<DayAttendancePicker days={[day({ label: null })]} />);

    expect(groupNames(picker)).toEqual(["2026-10-03"]);
  });

  it("marks only the first option of a day required, so a group is answered once", () => {
    const picker = mount(<DayAttendancePicker days={[day()]} />);

    const radios = [...picker.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => radio.required)).toEqual([true, false]);
  });

  it("names the low-capacity marker rather than leaving it to a tint", () => {
    const picker = mount(<DayAttendancePicker days={[day()]} lowCapacityThreshold={60} />);

    const badge = picker.querySelector(".event-flow-attendance-badge");
    expect(badge?.getAttribute("aria-label")).toBe("Limited spots remaining");
    expect(badge?.textContent).toBe("Limited spots");
  });

  it("says so plainly when the event has no per-day choice to make", () => {
    const picker = mount(<DayAttendancePicker days={[]} />);

    expect(picker.querySelectorAll("fieldset")).toHaveLength(0);
    expect(picker.textContent).toBe("No per-day attendance required for this event.");
  });

  it("renders a day whose attendance options are empty rather than failing on it", () => {
    const picker = mount(<DayAttendancePicker days={[day({ attendanceOptions: [] })]} />);

    expect(groupNames(picker)).toEqual(["Day one"]);
    expect(picker.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });
});
