import type { ComponentType, JSX } from "preact";
import type { EventFormsResponse } from "../shared/types";
import { IconInPerson, IconVirtual, IconOnDemand, IconCalendarCheck } from "./icons";

type EventDay = EventFormsResponse["eventDays"][number];

interface OptionConfig {
  Icon: ComponentType<Omit<JSX.SVGAttributes<SVGSVGElement>, "xmlns" | "viewBox" | "fill">>;
  color: string;
  description: string;
}

const OPTION_CONFIG: Record<string, OptionConfig> = {
  in_person: {
    Icon: IconInPerson,
    color: "#e05c3b",
    description: "Join us at the venue in person",
  },
  virtual: {
    Icon: IconVirtual,
    color: "#2b7de8",
    description: "Watch the live stream remotely",
  },
  on_demand: {
    Icon: IconOnDemand,
    color: "#7b2be8",
    description: "Watch the recording at your convenience",
  },
};

const FALLBACK_CONFIG: OptionConfig = {
  Icon: IconCalendarCheck,
  color: "#198754",
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
      <label class="event-flow-attendance-card" htmlFor={inputId} style={`--option-color: ${config.color}`}>
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
    return <p class="form-text">No per-day attendance required for this event.</p>;
  }

  return (
    <>
      {days.map((day) => (
        <div key={day.dayDate} class="event-flow-day mb-3">
          <p class="event-flow-day-label">{labelForDay(day)}</p>
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
        </div>
      ))}
    </>
  );
}
