import type { ComponentType, JSX } from "preact";
import type { EventFormsResponse } from "../shared/types";
import { IconMapPin, IconVirtual, IconOnDemand, IconCalendarCheck, IconRemove } from "./icons";
import { IconPeople, IconRoundtable } from "../ui/MediaIcons";
import { attendanceIconName, type AttendanceIconName } from "../../shared/event-attendance-icons";

type EventDay = EventFormsResponse["eventDays"][number];
type AttendanceOptionRead = EventDay["attendanceOptions"][number];
type AttendanceIconComponent = ComponentType<Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">>;

const OPTION_ICONS: Record<Exclude<AttendanceIconName, "none">, AttendanceIconComponent> = {
  location: IconMapPin,
  video: IconVirtual,
  play: IconOnDemand,
  calendar: IconCalendarCheck,
  people: IconPeople,
  roundtable: IconRoundtable,
};

/** The value a controlled picker reports for "not attending this day". */
export const NOT_ATTENDING = "";

/** What choosing a full option means: a badge on the option, and a line under the day once it is chosen. */
export const ATTENDANCE_WAITLIST_COPY = {
  badge: "Waitlist",
  line: (option: string) =>
    `${option} is full on this day. You'll join the waitlist and can watch live online in the meantime.`,
} as const;

function iconFor(type: string | null, configured?: AttendanceIconName): AttendanceIconComponent | null {
  if (type === null || type === NOT_ATTENDING) return IconRemove;
  const name = attendanceIconName(type, configured);
  return name === "none" ? null : OPTION_ICONS[name];
}

/** The icon a way of attending is shown with, wherever attendance is shown. */
export function AttendanceIcon({ type, icon }: { type: string | null; icon?: AttendanceIconName }) {
  const Icon = iconFor(type, icon);
  return Icon ? <Icon width="18" height="18" aria-hidden="true" /> : null;
}

/** An option with a capacity and no spot left: choosing it joins the waitlist. */
function isFull(option: AttendanceOptionRead): boolean {
  return option.spotsRemainingPercent != null && option.spotsRemainingPercent <= 0;
}

function labelForDay(day: EventDay): string {
  return day.label?.trim() || day.dayDate;
}

interface AttendanceOptionProps {
  day: EventDay;
  option: AttendanceOptionRead;
  lowCapacityThreshold: number;
  /** Controlled use: whether this option is the day's current choice, and how to choose it. */
  checked?: boolean;
  onSelect?: () => void;
}

/** One segment of a day's choice: the radio, then its label (the label's sibling selectors depend on that order). */
function AttendanceOption({ day, option, lowCapacityThreshold, checked, onSelect }: AttendanceOptionProps) {
  const Icon = iconFor(option.value, option.icon);
  const inputId = `dayAttendance-${day.dayDate}-${option.value || "none"}`;
  const full = isFull(option);
  const limited =
    !full &&
    lowCapacityThreshold > 0 &&
    option.spotsRemainingPercent != null &&
    option.spotsRemainingPercent <= lowCapacityThreshold;

  return (
    <>
      <input
        type="radio"
        class="event-flow-attendance-input"
        name={`dayAttendance.${day.dayDate}`}
        value={option.value}
        id={inputId}
        data-waitlist={full ? "" : undefined}
        aria-describedby={full ? `${inputId}-waitlist` : undefined}
        {...(onSelect ? { checked: Boolean(checked), onChange: onSelect } : {})}
      />
      <label
        class={full ? "event-flow-attendance-card event-flow-attendance-card--waitlist" : "event-flow-attendance-card"}
        htmlFor={inputId}
      >
        {Icon && <Icon class="event-flow-attendance-icon" width="16" height="16" aria-hidden="true" />}
        <span class="event-flow-attendance-title">{option.label}</span>
        {full && <span class="event-flow-attendance-badge">{ATTENDANCE_WAITLIST_COPY.badge}</span>}
        {limited && (
          <span class="event-flow-attendance-badge" aria-label="Limited spots remaining">
            Limited spots
          </span>
        )}
      </label>
    </>
  );
}

interface DayAttendancePickerProps {
  days: EventFormsResponse["eventDays"];
  lowCapacityThreshold?: number;
  /**
   * Controlled use, for changing an existing registration: each day's current
   * choice (`NOT_ATTENDING` for none) and how to change it. Without these the
   * radios are a plain form field set read on submit, as in the public form.
   */
  value?: Readonly<Record<string, string>>;
  onChange?: (dayDate: string, attendanceType: string) => void;
}

/**
 * Each day is a compact segmented choice: one row per day, its options side
 * by side. The chosen option takes the accent tint; a full option says
 * "Waitlist" before it is chosen and takes the caution tint once it is, with
 * one line under the day saying what that means.
 *
 * Each day is a `fieldset` named by its `legend`, so a screen reader says
 * which day an option belongs to.
 */
export function DayAttendancePicker({ days, lowCapacityThreshold = 0, value, onChange }: DayAttendancePickerProps) {
  if (days.length === 0) {
    return <p class="pk-small">No per-day attendance required for this event.</p>;
  }

  return (
    <div class="pk-stack">
      {days.map((day) => (
        <fieldset key={day.dayDate} class="pk-fieldset event-flow-day">
          <legend class="event-flow-day-label">{labelForDay(day)}</legend>
          <div class="event-flow-attendance-options">
            {[...day.attendanceOptions, { value: NOT_ATTENDING, label: "Not attending" }].map((option) => (
              <AttendanceOption
                key={option.value}
                day={day}
                option={option}
                lowCapacityThreshold={lowCapacityThreshold}
                {...(onChange
                  ? {
                      checked: (value?.[day.dayDate] ?? NOT_ATTENDING) === option.value,
                      onSelect: () => onChange(day.dayDate, option.value),
                    }
                  : {})}
              />
            ))}
          </div>
          {day.attendanceOptions.filter(isFull).map((option) => (
            <p
              key={option.value}
              id={`dayAttendance-${day.dayDate}-${option.value}-waitlist`}
              class="event-flow-attendance-waitlist"
            >
              {ATTENDANCE_WAITLIST_COPY.line(option.label)}
            </p>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
