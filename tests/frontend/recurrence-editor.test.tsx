// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recurrenceRuleSchema } from "../../assets/shared/schemas/event-series";
import {
  ADVANCED_RECURRENCE_MODE,
  MAX_RECURRENCE_INTERVAL,
  RecurrenceEditor,
  SINGLE_OCCURRENCE_RULE,
  buildRecurrenceRule,
  describeRecurrenceShape,
  matchRecurrenceShape,
  ordinalWeekdayFromDate,
  type RecurrenceShape,
} from "../../assets/ts/components/RecurrenceEditor";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("recurrence shape <-> RRULE round trip", () => {
  it("builds a rule the shared recurrenceRuleSchema accepts for every shape", () => {
    const shapes: RecurrenceShape[] = [
      { mode: "none" },
      { mode: "weekly", interval: 1 },
      { mode: "weekly", interval: 3 },
      { mode: "monthly_by_day", interval: 2 },
      { mode: "monthly_by_ordinal_weekday", interval: 1, ordinalWeekday: { ordinal: 2, weekday: "TU" } },
    ];
    for (const shape of shapes) {
      const rule = buildRecurrenceRule(shape);
      expect(recurrenceRuleSchema.safeParse(rule).success).toBe(true);
    }
  });

  it("an ad-hoc series is a one-occurrence rule that round-trips to the none shape", () => {
    expect(buildRecurrenceRule({ mode: "none" })).toBe(SINGLE_OCCURRENCE_RULE);
    expect(matchRecurrenceShape(SINGLE_OCCURRENCE_RULE)).toEqual({ mode: "none" });
  });

  it("free intervals round-trip: every 3 weeks and every other month are structured shapes", () => {
    expect(matchRecurrenceShape("FREQ=WEEKLY;INTERVAL=3")).toEqual({ mode: "weekly", interval: 3 });
    expect(matchRecurrenceShape("FREQ=MONTHLY;INTERVAL=2")).toEqual({ mode: "monthly_by_day", interval: 2 });
    expect(matchRecurrenceShape("FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR")).toEqual({
      mode: "monthly_by_ordinal_weekday",
      interval: 2,
      ordinalWeekday: { ordinal: -1, weekday: "FR" },
    });
  });

  it("matches a hand-authored string that omits the default INTERVAL=1", () => {
    expect(matchRecurrenceShape("FREQ=WEEKLY")).toEqual({ mode: "weekly", interval: 1 });
    expect(matchRecurrenceShape("FREQ=MONTHLY;BYDAY=1MO")).toEqual({
      mode: "monthly_by_ordinal_weekday",
      interval: 1,
      ordinalWeekday: { ordinal: 1, weekday: "MO" },
    });
  });

  it("a rule the structured controls cannot express falls back to custom (null match)", () => {
    expect(matchRecurrenceShape("FREQ=DAILY;INTERVAL=3")).toBeNull();
    expect(matchRecurrenceShape("FREQ=DAILY;COUNT=2")).toBeNull();
    expect(matchRecurrenceShape("FREQ=YEARLY")).toBeNull();
    expect(matchRecurrenceShape("FREQ=MONTHLY;BYMONTHDAY=15")).toBeNull();
    expect(matchRecurrenceShape(`FREQ=WEEKLY;INTERVAL=${MAX_RECURRENCE_INTERVAL + 1}`)).toBeNull();
  });

  it("describes shapes in plain words", () => {
    expect(describeRecurrenceShape({ mode: "none" })).toBe("One meeting only — does not repeat.");
    expect(describeRecurrenceShape({ mode: "weekly", interval: 1 })).toBe("Repeats every week.");
    expect(describeRecurrenceShape({ mode: "weekly", interval: 2 })).toBe("Repeats every other week.");
    expect(describeRecurrenceShape({ mode: "weekly", interval: 3 })).toBe("Repeats every 3 weeks.");
    expect(describeRecurrenceShape({ mode: "monthly_by_day", interval: 2 })).toBe(
      "Repeats every other month on the same date.",
    );
    expect(
      describeRecurrenceShape({
        mode: "monthly_by_ordinal_weekday",
        interval: 1,
        ordinalWeekday: { ordinal: -1, weekday: "FR" },
      }),
    ).toBe("Repeats every month on the last Friday.");
  });

  it("derives a plausible ordinal/weekday default from a reference date", () => {
    // 2026-09-08 is a Tuesday, the second Tuesday of September 2026.
    expect(ordinalWeekdayFromDate(new Date(2026, 8, 8))).toEqual({ ordinal: 2, weekday: "TU" });
    // 2026-09-29 is the last Tuesday of September 2026.
    expect(ordinalWeekdayFromDate(new Date(2026, 8, 29))).toEqual({ ordinal: -1, weekday: "TU" });
  });
});

describe("RecurrenceEditor component", () => {
  it("shows the matching shape and interval for a known rule", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=3" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    expect(select.value).toBe("weekly");
    expect(container.querySelector<HTMLInputElement>("#series-recurrence-interval")?.value).toBe("3");
    expect(container.textContent).toContain("Repeats every 3 weeks.");
    expect(container.querySelector("#series-recurrence-advanced")).toBeNull();
  });

  it("shows an ad-hoc single-occurrence rule as Does not repeat with no interval control", () => {
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value={SINGLE_OCCURRENCE_RULE} onChange={vi.fn()} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    expect(select.value).toBe("none");
    expect(container.querySelector("#series-recurrence-interval")).toBeNull();
    expect(container.textContent).toContain("One meeting only — does not repeat.");
  });

  it("choosing Does not repeat writes the one-occurrence rule via onChange", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    select.value = "none";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(SINGLE_OCCURRENCE_RULE);
  });

  it("changing the interval writes the widened rule via onChange", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=MONTHLY;INTERVAL=1" onChange={onChange} />,
    );
    const interval = container.querySelector<HTMLInputElement>("#series-recurrence-interval")!;
    interval.value = "2";
    void act(() => {
      interval.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("FREQ=MONTHLY;INTERVAL=2");
  });

  it("ignores an out-of-range interval instead of emitting an invalid rule", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={onChange} />,
    );
    const interval = container.querySelector<HTMLInputElement>("#series-recurrence-interval")!;
    interval.value = "0";
    void act(() => {
      interval.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens directly in custom mode for a rule that matches no shape", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=MONTHLY;BYMONTHDAY=15" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    expect(select.value).toBe(ADVANCED_RECURRENCE_MODE);
    const advanced = container.querySelector<HTMLInputElement>("#series-recurrence-advanced")!;
    expect(advanced.value).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
    expect(container.textContent).toContain("RFC 5545 recurrence rule");
  });

  it("switching to the monthly ordinal-weekday shape exposes ordinal and weekday controls", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    select.value = "monthly_by_ordinal_weekday";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^FREQ=MONTHLY;INTERVAL=1;BYDAY=-?\d[A-Z]{2}$/));

    const weekday = container.querySelector<HTMLSelectElement>("#series-recurrence-weekday")!;
    weekday.value = "FR";
    void act(() => {
      weekday.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const ordinal = container.querySelector<HTMLSelectElement>("#series-recurrence-ordinal")!;
    ordinal.value = "-1";
    void act(() => {
      ordinal.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith("FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR");
  });

  it("editing the raw string in custom mode passes it straight through", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=MONTHLY;BYMONTHDAY=15" onChange={onChange} />,
    );
    const advanced = container.querySelector<HTMLInputElement>("#series-recurrence-advanced")!;
    advanced.value = "FREQ=MONTHLY;BYMONTHDAY=1,15";
    void act(() => {
      advanced.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("FREQ=MONTHLY;BYMONTHDAY=1,15");
  });

  it("disables the controls when disabled is set", () => {
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={vi.fn()} disabled />,
    );
    expect(container.querySelector<HTMLSelectElement>("#series-recurrence")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#series-recurrence-interval")?.disabled).toBe(true);
  });
});
