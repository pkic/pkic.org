import { useEffect, useId, useState } from "preact/hooks";

import { Field } from "../ui/Field";
import { Select, TextInput } from "../ui/TextControl";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../ui/Content.css";

/**
 * Recurrence shapes the backend expansion (ICAL.Recur, driven by
 * `functions/_lib/services/event-series/recurrence.ts`) understands as plain
 * RFC 5545 RRULE strings. The shared `recurrenceRuleSchema` only requires a
 * `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` token; everything else is whatever
 * ical.js's `Recur.fromString` accepts.
 *
 * Instead of a fixed preset list, the editor composes a shape (weekly,
 * monthly by date, monthly by ordinal weekday) with a free interval, so
 * "every 3 weeks" and "every other month" are first-class. An ad-hoc series
 * is a real shape too: `FREQ=DAILY;COUNT=1` expands to exactly one
 * occurrence at the series start, which keeps the stored rule non-null
 * without any schema change.
 */
export const RECURRENCE_MODES = ["none", "weekly", "monthly_by_day", "monthly_by_ordinal_weekday"] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const RECURRENCE_MODE_LABELS: Record<RecurrenceMode, string> = {
  none: "Does not repeat",
  weekly: "Weekly",
  monthly_by_day: "Monthly, same date",
  monthly_by_ordinal_weekday: "Monthly, on a weekday",
};

export const ADVANCED_RECURRENCE_MODE = "__advanced__";

/** The one-occurrence rule an ad-hoc series stores; satisfies the NOT NULL column and RFC 5545 alike. */
export const SINGLE_OCCURRENCE_RULE = "FREQ=DAILY;COUNT=1";

export const RECURRENCE_WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type RecurrenceWeekday = (typeof RECURRENCE_WEEKDAYS)[number];
const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

export const RECURRENCE_ORDINALS = [1, 2, 3, 4, -1] as const;
export type RecurrenceOrdinal = (typeof RECURRENCE_ORDINALS)[number];
const ORDINAL_LABELS: Record<RecurrenceOrdinal, string> = {
  1: "First",
  2: "Second",
  3: "Third",
  4: "Fourth",
  [-1]: "Last",
};

const JS_WEEKDAY_TO_RRULE: RecurrenceWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const MAX_RECURRENCE_INTERVAL = 26;

export interface MonthlyOrdinalWeekday {
  ordinal: RecurrenceOrdinal;
  weekday: RecurrenceWeekday;
}

export type RecurrenceShape =
  | { mode: "none" }
  | { mode: "weekly"; interval: number }
  | { mode: "monthly_by_day"; interval: number }
  | { mode: "monthly_by_ordinal_weekday"; interval: number; ordinalWeekday: MonthlyOrdinalWeekday };

function parseRuleParts(rule: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const segment of rule.split(";")) {
    const [rawKey, ...rest] = segment.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rest.join("=").trim();
    if (key && value) parts[key] = value;
  }
  return parts;
}

const BYDAY_PATTERN = /^(-?[1-4])(MO|TU|WE|TH|FR|SA|SU)$/;

/** Builds the canonical RRULE string for one shape. Pure and side-effect free for testing. */
export function buildRecurrenceRule(shape: RecurrenceShape): string {
  switch (shape.mode) {
    case "none":
      return SINGLE_OCCURRENCE_RULE;
    case "weekly":
      return `FREQ=WEEKLY;INTERVAL=${shape.interval}`;
    case "monthly_by_day":
      return `FREQ=MONTHLY;INTERVAL=${shape.interval}`;
    case "monthly_by_ordinal_weekday": {
      const { ordinal, weekday } = shape.ordinalWeekday;
      return `FREQ=MONTHLY;INTERVAL=${shape.interval};BYDAY=${ordinal}${weekday}`;
    }
  }
}

function isValidInterval(interval: number): boolean {
  return Number.isInteger(interval) && interval >= 1 && interval <= MAX_RECURRENCE_INTERVAL;
}

/**
 * Matches an RRULE string against the composable shapes. Returns `null` when
 * the rule is valid but expresses something the structured controls cannot
 * (arbitrary BYDAY lists, UNTIL bounds, yearly rules…), so the caller falls
 * back to advanced (raw-string) mode.
 */
export function matchRecurrenceShape(rule: string): RecurrenceShape | null {
  const parts = parseRuleParts(rule);
  const keys = new Set(Object.keys(parts));
  const freq = parts.FREQ;
  const interval = parts.INTERVAL !== undefined ? Number(parts.INTERVAL) : 1;
  if (!freq) return null;

  if (freq === "DAILY" && parts.COUNT === "1") {
    const onlyFreqCountInterval = [...keys].every((key) => key === "FREQ" || key === "COUNT" || key === "INTERVAL");
    if (onlyFreqCountInterval && (parts.INTERVAL === undefined || interval === 1)) return { mode: "none" };
    return null;
  }
  if (!isValidInterval(interval)) return null;

  const onlyFreqAndInterval = [...keys].every((key) => key === "FREQ" || key === "INTERVAL");

  if (freq === "WEEKLY" && onlyFreqAndInterval) {
    return { mode: "weekly", interval };
  }

  if (freq === "MONTHLY") {
    if (onlyFreqAndInterval) return { mode: "monthly_by_day", interval };
    const onlyFreqIntervalByday = [...keys].every((key) => key === "FREQ" || key === "INTERVAL" || key === "BYDAY");
    if (onlyFreqIntervalByday && parts.BYDAY) {
      const match = BYDAY_PATTERN.exec(parts.BYDAY);
      if (match) {
        return {
          mode: "monthly_by_ordinal_weekday",
          interval,
          ordinalWeekday: { ordinal: Number(match[1]) as RecurrenceOrdinal, weekday: match[2] as RecurrenceWeekday },
        };
      }
    }
  }

  return null;
}

/** Human summary of a shape, e.g. "Repeats every 3 weeks" — words for 1 and 2, numerals beyond. */
export function describeRecurrenceShape(shape: RecurrenceShape): string {
  const every = (interval: number, unit: string): string => {
    if (interval === 1) return `every ${unit}`;
    if (interval === 2) return `every other ${unit}`;
    return `every ${interval} ${unit}s`;
  };
  switch (shape.mode) {
    case "none":
      return "One meeting only — does not repeat.";
    case "weekly":
      return `Repeats ${every(shape.interval, "week")}.`;
    case "monthly_by_day":
      return `Repeats ${every(shape.interval, "month")} on the same date.`;
    case "monthly_by_ordinal_weekday": {
      const { ordinal, weekday } = shape.ordinalWeekday;
      return `Repeats ${every(shape.interval, "month")} on the ${ORDINAL_LABELS[ordinal].toLowerCase()} ${WEEKDAY_LABELS[weekday]}.`;
    }
  }
}

/** Derives a sensible default ordinal/weekday pair from a reference date, for the ordinal-weekday shape. */
export function ordinalWeekdayFromDate(date: Date): MonthlyOrdinalWeekday {
  const weekday = JS_WEEKDAY_TO_RRULE[date.getDay()];
  const dayOfMonth = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const ordinal: RecurrenceOrdinal = dayOfMonth > daysInMonth - 7 ? -1 : (Math.ceil(dayOfMonth / 7) as 1 | 2 | 3 | 4);
  return { ordinal, weekday };
}

function coerceDate(value: string | Date | undefined): Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? new Date() : value;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Composable recurrence editor. A shape select (does not repeat, weekly,
 * monthly by date, monthly by weekday) pairs with a free "every N" interval,
 * so ad-hoc meetings, every-3-weeks, and every-other-month schedules are all
 * structured choices; a "Custom rule" option reveals the raw RFC 5545 string
 * for anything else. Round-trips: loading an existing rule that matches a
 * shape shows that shape, otherwise it opens directly in custom mode. The
 * value handed to `onChange` is always the plain RRULE string — the contract
 * never changes shape.
 */
export function RecurrenceEditor({
  value,
  onChange,
  disabled = false,
  required = true,
  referenceDate,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  referenceDate?: string | Date;
}) {
  const initialShape = matchRecurrenceShape(value);
  const [mode, setMode] = useState<RecurrenceMode | typeof ADVANCED_RECURRENCE_MODE>(
    initialShape?.mode ?? ADVANCED_RECURRENCE_MODE,
  );
  const [interval, setInterval] = useState(initialShape && initialShape.mode !== "none" ? initialShape.interval : 1);
  const [ordinalWeekday, setOrdinalWeekday] = useState<MonthlyOrdinalWeekday>(
    initialShape?.mode === "monthly_by_ordinal_weekday"
      ? initialShape.ordinalWeekday
      : ordinalWeekdayFromDate(coerceDate(referenceDate)),
  );
  const [advancedValue, setAdvancedValue] = useState(value);

  useEffect(() => {
    const matched = matchRecurrenceShape(value);
    setMode(matched?.mode ?? ADVANCED_RECURRENCE_MODE);
    if (matched && matched.mode !== "none") setInterval(matched.interval);
    if (matched?.mode === "monthly_by_ordinal_weekday") setOrdinalWeekday(matched.ordinalWeekday);
    setAdvancedValue(value);
    // Only re-derive local editor state when the caller's value changes out
    // from under us (e.g. a different series loaded); onChange calls below
    // feed the same normalized string back in, so this does not loop.
  }, [value]);

  function shapeFor(
    nextMode: RecurrenceMode,
    nextInterval: number,
    nextOrdinalWeekday: MonthlyOrdinalWeekday,
  ): RecurrenceShape {
    if (nextMode === "none") return { mode: "none" };
    if (nextMode === "monthly_by_ordinal_weekday") {
      return { mode: nextMode, interval: nextInterval, ordinalWeekday: nextOrdinalWeekday };
    }
    return { mode: nextMode, interval: nextInterval };
  }

  function selectMode(next: RecurrenceMode | typeof ADVANCED_RECURRENCE_MODE): void {
    setMode(next);
    if (next === ADVANCED_RECURRENCE_MODE) {
      onChange(advancedValue || value);
      return;
    }
    onChange(buildRecurrenceRule(shapeFor(next, interval, ordinalWeekday)));
  }

  function updateInterval(raw: string): void {
    const next = Number(raw);
    if (!isValidInterval(next) || mode === ADVANCED_RECURRENCE_MODE || mode === "none") return;
    setInterval(next);
    onChange(buildRecurrenceRule(shapeFor(mode, next, ordinalWeekday)));
  }

  function updateOrdinalWeekday(patch: Partial<MonthlyOrdinalWeekday>): void {
    const next = { ...ordinalWeekday, ...patch };
    setOrdinalWeekday(next);
    if (mode !== "monthly_by_ordinal_weekday") return;
    onChange(buildRecurrenceRule({ mode, interval, ordinalWeekday: next }));
  }

  function updateAdvanced(next: string): void {
    setAdvancedValue(next);
    onChange(next);
  }

  const summaryId = `${useId()}-summary`;
  const intervalUnit = mode === "weekly" ? "weeks" : "months";
  const currentShape = mode === ADVANCED_RECURRENCE_MODE ? null : shapeFor(mode, interval, ordinalWeekday);

  /*
   * Each control is a design-system `Field`, which owns its label and its id.
   * The ordinal and weekday choices used to carry an `aria-label` and no
   * visible label at all, and the interval's unit was a bare span beside the
   * box — announced to nobody. Each control has a real label naming both the
   * choice and its unit.
   */
  return (
    <div class="pk pk-stack pk-stack--snug">
      <Field label="Repeats">
        {(control) => (
          <Select
            {...control}
            value={mode}
            disabled={disabled}
            // The plain-English summary below is what the chosen shape actually
            // means, so it is announced with the control that sets it rather
            // than left as loose prose underneath.
            aria-describedby={currentShape ? summaryId : undefined}
            onChange={(event) =>
              selectMode((event.target as HTMLSelectElement).value as RecurrenceMode | typeof ADVANCED_RECURRENCE_MODE)
            }
          >
            {RECURRENCE_MODES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {RECURRENCE_MODE_LABELS[candidate]}
              </option>
            ))}
            <option value={ADVANCED_RECURRENCE_MODE}>Custom rule</option>
          </Select>
        )}
      </Field>

      {mode !== ADVANCED_RECURRENCE_MODE && mode !== "none" && (
        <div class="pk-grid pk-grid--tight">
          <Field label={`Repeat every (${intervalUnit})`}>
            {(control) => (
              <TextInput
                {...control}
                type="number"
                min={1}
                max={MAX_RECURRENCE_INTERVAL}
                value={interval}
                disabled={disabled}
                onInput={(event) => updateInterval((event.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          {mode === "monthly_by_ordinal_weekday" && (
            <>
              <Field label="Week of the month">
                {(control) => (
                  <Select
                    {...control}
                    value={ordinalWeekday.ordinal}
                    disabled={disabled}
                    onChange={(event) =>
                      updateOrdinalWeekday({
                        ordinal: Number((event.target as HTMLSelectElement).value) as RecurrenceOrdinal,
                      })
                    }
                  >
                    {RECURRENCE_ORDINALS.map((ordinal) => (
                      <option key={ordinal} value={ordinal}>
                        {ORDINAL_LABELS[ordinal]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Weekday">
                {(control) => (
                  <Select
                    {...control}
                    value={ordinalWeekday.weekday}
                    disabled={disabled}
                    onChange={(event) =>
                      updateOrdinalWeekday({ weekday: (event.target as HTMLSelectElement).value as RecurrenceWeekday })
                    }
                  >
                    {RECURRENCE_WEEKDAYS.map((weekday) => (
                      <option key={weekday} value={weekday}>
                        {WEEKDAY_LABELS[weekday]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
        </div>
      )}

      {/* A sentence about the shape the whole editor describes, not one
          control's help text: it sits outside every field, below the choices
          that together produce it, so it is muted small print. The mode select
          still names it through `aria-describedby`. */}
      {currentShape && (
        <p class="pk-muted pk-small" id={summaryId}>
          {describeRecurrenceShape(currentShape)}
        </p>
      )}

      {mode === ADVANCED_RECURRENCE_MODE && (
        <Field
          label="Custom rule"
          required={required}
          help="RFC 5545 recurrence rule, for schedules the structured choices cannot express."
        >
          {(control) => (
            <TextInput
              {...control}
              class="pk-mono"
              value={advancedValue}
              disabled={disabled}
              onInput={(event) => updateAdvanced((event.target as HTMLInputElement).value)}
            />
          )}
        </Field>
      )}
    </div>
  );
}
