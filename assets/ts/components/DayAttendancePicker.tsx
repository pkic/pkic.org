import type { ComponentType, JSX } from "preact";
import type { EventFormsResponse } from "../shared/types";
import { IconMapPin, IconVirtual, IconOnDemand, IconCalendarCheck, IconRemove } from "./icons";

type EventDay = EventFormsResponse["eventDays"][number];

interface OptionConfig {
  Icon: ComponentType<Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">>;
  themeClass: string;
  description: string;
}

const OPTION_CONFIG: Record<string, OptionConfig> = {
  in_person: {
    Icon: IconMapPin,
    themeClass: "event-flow-attendance-card--in-person",
    description: "Join us at the venue in person",
  },
  virtual: {
    Icon: IconVirtual,
    themeClass: "event-flow-attendance-card--virtual",
    description: "Watch the live stream remotely",
  },
  on_demand: {
    Icon: IconOnDemand,
    themeClass: "event-flow-attendance-card--on-demand",
    description: "Watch the recording at your convenience",
  },
};

/** The value a controlled picker reports for "not attending this day". */
export const NOT_ATTENDING = "";

const NOT_ATTENDING_CONFIG: OptionConfig = {
  Icon: IconRemove,
  themeClass: "event-flow-attendance-card--default",
  description: "Free this day for someone else",
};

const FALLBACK_CONFIG: OptionConfig = {
  Icon: IconCalendarCheck,
  themeClass: "event-flow-attendance-card--default",
  description: "Select your attendance preference",
};

/** The icon a way of attending is shown with, wherever attendance is shown. */
export function AttendanceIcon({ type }: { type: string | null }) {
  const { Icon } = type === null ? NOT_ATTENDING_CONFIG : (OPTION_CONFIG[type] ?? FALLBACK_CONFIG);
  return <Icon width="18" height="18" aria-hidden="true" />;
}

function labelForDay(day: EventDay): string {
  return day.label?.trim() || day.dayDate;
}

interface AttendanceOptionProps {
  day: EventDay;
  option: EventDay["attendanceOptions"][number];
  index: number;
  lowCapacityThreshold: number;
  /** Controlled use: whether this option is the day's current choice, and how to choose it. */
  checked?: boolean;
  onSelect?: () => void;
}

function AttendanceOption({ day, option, index, lowCapacityThreshold, checked, onSelect }: AttendanceOptionProps) {
  const config =
    option.value === NOT_ATTENDING ? NOT_ATTENDING_CONFIG : (OPTION_CONFIG[option.value] ?? FALLBACK_CONFIG);
  const { Icon } = config;
  const inputId = `dayAttendance-${day.dayDate}-${option.value || "none"}`;
  const showBadge =
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
        required={!onSelect && index === 0}
        {...(onSelect ? { checked: Boolean(checked), onChange: onSelect } : {})}
      />
      <label class={`event-flow-attendance-card ${config.themeClass}`} htmlFor={inputId}>
        <span class="event-flow-attendance-icon">
          <Icon width="18" height="18" />
        </span>
        <span class="event-flow-attendance-text">
          <span class="event-flow-attendance-title">{option.label}</span>
          <span class="event-flow-attendance-desc">{config.description}</span>
          {showBadge && (
            <span class="event-flow-attendance-badge" aria-label="Limited spots remaining">
              Limited spots
            </span>
          )}
        </span>
        <span class="event-flow-attendance-radio" aria-hidden="true" />
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
  /** Adds a "Not attending" choice per day; a registration may drop a day. */
  allowNotAttending?: boolean;
}

export function DayAttendancePicker({
  days,
  lowCapacityThreshold = 0,
  value,
  onChange,
  allowNotAttending = false,
}: DayAttendancePickerProps) {
  if (days.length === 0) {
    return <p class="pk-small">No per-day attendance required for this event.</p>;
  }

  /*
   * Each day is a `fieldset` named by its `legend`, not a `div` headed by a
   * paragraph. The options are radios sharing one `name`, so they are a group
   * whether or not the markup says so — and without the legend a screen
   * reader announced "In person, radio, 1 of 3" with nothing saying which
   * day it belonged to, on an event with a card per day.
   *
   * `pk-fieldset` supplies the reset the element needs (no groove border, no
   * user-agent padding, no `min-inline-size: min-content`); the spacing
   * between days is the stack's `gap` rather than a margin on each child.
   */
  return (
    <div class="pk-stack">
      {days.map((day) => (
        <fieldset key={day.dayDate} class="pk-fieldset event-flow-day">
          <legend class="event-flow-day-label">{labelForDay(day)}</legend>
          <div class="event-flow-attendance-options">
            {[
              ...day.attendanceOptions,
              ...(allowNotAttending ? [{ value: NOT_ATTENDING, label: "Not attending" }] : []),
            ].map((option, i) => (
              <AttendanceOption
                key={option.value}
                day={day}
                option={option}
                index={i}
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
        </fieldset>
      ))}
    </div>
  );
}
