import { useEffect, useState } from "preact/hooks";

/**
 * Preset recurrence shapes the backend expansion (ICAL.Recur, driven by
 * `functions/_lib/services/event-series/recurrence.ts`) understands as plain
 * RFC 5545 RRULE strings. The shared `recurrenceRuleSchema` only requires a
 * `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` token; everything else is whatever
 * ical.js's `Recur.fromString` accepts, so these presets are convenience
 * shortcuts onto that grammar, not a separate backend vocabulary.
 */
export const RECURRENCE_PRESET_KEYS = [
  "weekly",
  "every_two_weeks",
  "monthly_by_day",
  "monthly_by_ordinal_weekday",
] as const;
export type RecurrencePresetKey = (typeof RECURRENCE_PRESET_KEYS)[number];

export const RECURRENCE_PRESET_LABELS: Record<RecurrencePresetKey, string> = {
  weekly: "Weekly",
  every_two_weeks: "Every two weeks",
  monthly_by_day: "Monthly, same date",
  monthly_by_ordinal_weekday: "Monthly, on an ordinal weekday",
};

export const ADVANCED_RECURRENCE_MODE = "__advanced__";

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

export interface MonthlyOrdinalWeekday {
  ordinal: RecurrenceOrdinal;
  weekday: RecurrenceWeekday;
}

export interface MatchedRecurrencePreset {
  preset: RecurrencePresetKey;
  ordinalWeekday?: MonthlyOrdinalWeekday;
}

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

/** Builds the canonical RRULE string for one preset. Pure and side-effect free for testing. */
export function buildRecurrenceRule(preset: RecurrencePresetKey, ordinalWeekday?: MonthlyOrdinalWeekday): string {
  switch (preset) {
    case "weekly":
      return "FREQ=WEEKLY;INTERVAL=1";
    case "every_two_weeks":
      return "FREQ=WEEKLY;INTERVAL=2";
    case "monthly_by_day":
      return "FREQ=MONTHLY;INTERVAL=1";
    case "monthly_by_ordinal_weekday": {
      const { ordinal, weekday } = ordinalWeekday ?? { ordinal: 1, weekday: "MO" };
      return `FREQ=MONTHLY;INTERVAL=1;BYDAY=${ordinal}${weekday}`;
    }
  }
}

/**
 * Matches an RRULE string against the known presets. Returns `null` when the
 * rule is valid but does not correspond to any preset shape, so the caller
 * falls back to advanced (raw-string) mode.
 */
export function matchRecurrencePreset(rule: string): MatchedRecurrencePreset | null {
  const parts = parseRuleParts(rule);
  const keys = new Set(Object.keys(parts));
  const freq = parts.FREQ;
  const interval = parts.INTERVAL !== undefined ? Number(parts.INTERVAL) : 1;
  if (!freq || !Number.isFinite(interval)) return null;

  const onlyFreqAndInterval = [...keys].every((key) => key === "FREQ" || key === "INTERVAL");

  if (freq === "WEEKLY" && onlyFreqAndInterval) {
    if (interval === 1) return { preset: "weekly" };
    if (interval === 2) return { preset: "every_two_weeks" };
    return null;
  }

  if (freq === "MONTHLY" && interval === 1) {
    if (onlyFreqAndInterval) return { preset: "monthly_by_day" };
    const onlyFreqIntervalByday = [...keys].every((key) => key === "FREQ" || key === "INTERVAL" || key === "BYDAY");
    if (onlyFreqIntervalByday && parts.BYDAY) {
      const match = BYDAY_PATTERN.exec(parts.BYDAY);
      if (match) {
        return {
          preset: "monthly_by_ordinal_weekday",
          ordinalWeekday: { ordinal: Number(match[1]) as RecurrenceOrdinal, weekday: match[2] as RecurrenceWeekday },
        };
      }
    }
  }

  return null;
}

/** Derives a sensible default ordinal/weekday pair from a reference date, for the ordinal-weekday preset. */
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
 * Preset-first recurrence-rule editor. Common shapes are chosen from a
 * select and written as an RFC 5545 RRULE string; an "Advanced" option
 * reveals the raw string for anything else. Round-trips: loading an existing
 * rule that matches a preset shows that preset, otherwise it opens directly
 * in advanced mode. The value handed to `onChange` is always the plain RRULE
 * string — the contract never changes shape.
 */
export function RecurrenceEditor({
  id,
  value,
  onChange,
  disabled = false,
  required = true,
  referenceDate,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  referenceDate?: string | Date;
}) {
  const initialMatch = matchRecurrencePreset(value);
  const [mode, setMode] = useState<RecurrencePresetKey | typeof ADVANCED_RECURRENCE_MODE>(
    initialMatch?.preset ?? ADVANCED_RECURRENCE_MODE,
  );
  const [ordinalWeekday, setOrdinalWeekday] = useState<MonthlyOrdinalWeekday>(
    initialMatch?.ordinalWeekday ?? ordinalWeekdayFromDate(coerceDate(referenceDate)),
  );
  const [advancedValue, setAdvancedValue] = useState(value);

  useEffect(() => {
    const matched = matchRecurrencePreset(value);
    setMode(matched?.preset ?? ADVANCED_RECURRENCE_MODE);
    if (matched?.ordinalWeekday) setOrdinalWeekday(matched.ordinalWeekday);
    setAdvancedValue(value);
    // Only re-derive local editor state when the caller's value changes out
    // from under us (e.g. a different series loaded); onChange calls below
    // feed the same normalized string back in, so this does not loop.
  }, [value]);

  function selectMode(next: RecurrencePresetKey | typeof ADVANCED_RECURRENCE_MODE): void {
    setMode(next);
    if (next === ADVANCED_RECURRENCE_MODE) {
      onChange(advancedValue || value);
      return;
    }
    onChange(buildRecurrenceRule(next, next === "monthly_by_ordinal_weekday" ? ordinalWeekday : undefined));
  }

  function updateOrdinalWeekday(patch: Partial<MonthlyOrdinalWeekday>): void {
    const next = { ...ordinalWeekday, ...patch };
    setOrdinalWeekday(next);
    onChange(buildRecurrenceRule("monthly_by_ordinal_weekday", next));
  }

  function updateAdvanced(next: string): void {
    setAdvancedValue(next);
    onChange(next);
  }

  const helpId = `${id}-help`;

  return (
    <div>
      <label class="form-label small fw-semibold" for={id}>
        Recurrence rule
      </label>
      <select
        id={id}
        class="form-select"
        value={mode}
        disabled={disabled}
        onChange={(event) =>
          selectMode((event.target as HTMLSelectElement).value as RecurrencePresetKey | typeof ADVANCED_RECURRENCE_MODE)
        }
      >
        {RECURRENCE_PRESET_KEYS.map((preset) => (
          <option key={preset} value={preset}>
            {RECURRENCE_PRESET_LABELS[preset]}
          </option>
        ))}
        <option value={ADVANCED_RECURRENCE_MODE}>Custom (advanced)</option>
      </select>
      {mode === "monthly_by_ordinal_weekday" && (
        <div class="d-flex gap-2 mt-2">
          <select
            id={`${id}-ordinal`}
            aria-label="Ordinal week of the month"
            class="form-select form-select-sm"
            value={ordinalWeekday.ordinal}
            disabled={disabled}
            onChange={(event) =>
              updateOrdinalWeekday({ ordinal: Number((event.target as HTMLSelectElement).value) as RecurrenceOrdinal })
            }
          >
            {RECURRENCE_ORDINALS.map((ordinal) => (
              <option key={ordinal} value={ordinal}>
                {ORDINAL_LABELS[ordinal]}
              </option>
            ))}
          </select>
          <select
            id={`${id}-weekday`}
            aria-label="Weekday"
            class="form-select form-select-sm"
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
          </select>
        </div>
      )}
      {mode === ADVANCED_RECURRENCE_MODE && (
        <>
          <input
            id={`${id}-advanced`}
            class="form-control font-monospace mt-2"
            value={advancedValue}
            required={required}
            disabled={disabled}
            aria-describedby={helpId}
            onInput={(event) => updateAdvanced((event.target as HTMLInputElement).value)}
          />
          <div id={helpId} class="form-text">
            RFC 5545 recurrence rule. Presets are suggestions; other valid recurring schedules are supported.
          </div>
        </>
      )}
    </div>
  );
}
