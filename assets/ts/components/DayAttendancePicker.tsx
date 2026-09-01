import type { ComponentType, JSX } from "preact";
import type { EventFormsResponse } from "../shared/types";
import { IconInPerson, IconVirtual, IconOnDemand, IconCalendarCheck } from "./icons";

type EventDay = EventFormsResponse["eventDays"][number];

interface OptionConfig {
  Icon: ComponentType<Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">>;
  themeClass: string;
  description: string;
}

const OPTION_CONFIG: Record<string, OptionConfig> = {
  in_person: {
    Icon: IconInPerson,
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

const FALLBACK_CONFIG: OptionConfig = {
  Icon: IconCalendarCheck,
  themeClass: "event-flow-attendance-card--default",
  description: "Select your attendance preference",
};

function labelForDay(day: EventDay): string {
  return day.label?.trim() || day.dayDate;
}

interface AttendanceOptionProps {
  day: EventDay;
  option: EventDay["attendanceOptions"][number];
  index: number;
  lowCapacityThreshold: number;
}

function AttendanceOption({ day, option, index, lowCapacityThreshold }: AttendanceOptionProps) {
  const config = OPTION_CONFIG[option.value] ?? FALLBACK_CONFIG;
  const { Icon } = config;
  const inputId = `dayAttendance-${day.dayDate}-${option.value}`;
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
        required={index === 0}
      />
      <label class={`event-flow-attendance-card ${config.themeClass}`} htmlFor={inputId}>
        <span class="event-flow-attendance-icon">
          <Icon />
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
}

export function DayAttendancePicker({ days, lowCapacityThreshold = 0 }: DayAttendancePickerProps) {
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
            {day.attendanceOptions.map((option, i) => (
              <AttendanceOption
                key={option.value}
                day={day}
                option={option}
                index={i}
                lowCapacityThreshold={lowCapacityThreshold}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
