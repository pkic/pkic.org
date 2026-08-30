// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recurrenceRuleSchema } from "../../assets/shared/schemas/event-series";
import {
  ADVANCED_RECURRENCE_MODE,
  RECURRENCE_PRESET_KEYS,
  RecurrenceEditor,
  buildRecurrenceRule,
  matchRecurrencePreset,
  ordinalWeekdayFromDate,
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

describe("recurrence preset <-> RRULE round trip", () => {
  it("builds a rule the shared recurrenceRuleSchema accepts for every preset", () => {
    for (const preset of RECURRENCE_PRESET_KEYS) {
      const rule = buildRecurrenceRule(preset, { ordinal: 2, weekday: "TU" });
      expect(() => recurrenceRuleSchema.parse(rule)).not.toThrow();
    }
  });

  it("preset -> string -> preset recovers the same preset (weekly, every two weeks, monthly by day)", () => {
    expect(matchRecurrencePreset(buildRecurrenceRule("weekly"))).toEqual({ preset: "weekly" });
    expect(matchRecurrencePreset(buildRecurrenceRule("every_two_weeks"))).toEqual({ preset: "every_two_weeks" });
    expect(matchRecurrencePreset(buildRecurrenceRule("monthly_by_day"))).toEqual({ preset: "monthly_by_day" });
  });

  it("preset -> string -> preset recovers the ordinal and weekday for monthly-by-ordinal-weekday", () => {
    const rule = buildRecurrenceRule("monthly_by_ordinal_weekday", { ordinal: 2, weekday: "TU" });
    expect(rule).toBe("FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU");
    expect(matchRecurrencePreset(rule)).toEqual({
      preset: "monthly_by_ordinal_weekday",
      ordinalWeekday: { ordinal: 2, weekday: "TU" },
    });
  });

  it("recognizes the last-weekday-of-the-month ordinal", () => {
    const rule = buildRecurrenceRule("monthly_by_ordinal_weekday", { ordinal: -1, weekday: "FR" });
    expect(matchRecurrencePreset(rule)).toEqual({
      preset: "monthly_by_ordinal_weekday",
      ordinalWeekday: { ordinal: -1, weekday: "FR" },
    });
  });

  it("matches a hand-authored string that omits the default INTERVAL=1", () => {
    expect(matchRecurrencePreset("FREQ=WEEKLY")).toEqual({ preset: "weekly" });
    expect(matchRecurrencePreset("FREQ=MONTHLY;BYDAY=1MO")).toEqual({
      preset: "monthly_by_ordinal_weekday",
      ordinalWeekday: { ordinal: 1, weekday: "MO" },
    });
  });

  it("a rule an author typed by hand that does not match any preset falls back to advanced (null match)", () => {
    expect(matchRecurrencePreset("FREQ=DAILY;INTERVAL=3")).toBeNull();
    expect(matchRecurrencePreset("FREQ=WEEKLY;INTERVAL=3")).toBeNull();
    expect(matchRecurrencePreset("FREQ=MONTHLY;INTERVAL=2")).toBeNull();
    expect(matchRecurrencePreset("FREQ=YEARLY")).toBeNull();
    expect(matchRecurrencePreset("FREQ=MONTHLY;BYMONTHDAY=15")).toBeNull();
  });

  it("derives a plausible ordinal/weekday default from a reference date", () => {
    // 2026-09-08 is a Tuesday, the second Tuesday of September 2026.
    expect(ordinalWeekdayFromDate(new Date(2026, 8, 8))).toEqual({ ordinal: 2, weekday: "TU" });
    // 2026-09-29 is the last Tuesday of September 2026.
    expect(ordinalWeekdayFromDate(new Date(2026, 8, 29))).toEqual({ ordinal: -1, weekday: "TU" });
  });
});

describe("RecurrenceEditor component", () => {
  it("opens in preset mode and shows the matching preset for a known rule", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=2" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("every_two_weeks");
    expect(container.querySelector("#series-recurrence-advanced")).toBeNull();
  });

  it("opens directly in advanced mode for a rule that matches no preset", () => {
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

  it("choosing a preset writes the canonical RRULE string via onChange", () => {
    const onChange = vi.fn();
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={onChange} />,
    );
    const select = container.querySelector<HTMLSelectElement>("#series-recurrence")!;
    select.value = "monthly_by_day";
    void act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("FREQ=MONTHLY;INTERVAL=1");
  });

  it("switching to the monthly ordinal-weekday preset exposes ordinal and weekday controls", () => {
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

  it("editing the raw string in advanced mode passes it straight through", () => {
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

  it("disables the preset select when disabled is set", () => {
    const container = mount(
      <RecurrenceEditor id="series-recurrence" value="FREQ=WEEKLY;INTERVAL=1" onChange={vi.fn()} disabled />,
    );
    expect(container.querySelector<HTMLSelectElement>("#series-recurrence")?.disabled).toBe(true);
  });
});
