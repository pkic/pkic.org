import { useId, useRef, useState } from "preact/hooks";
import { DataTable, type DataTableColumn } from "../ui/DataTable";
import { Radio } from "../ui/Checkbox";
import { Button } from "../ui/Button";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { Alert } from "../ui/Alert";
import "./DayAttendancePicker.css";
import {
  calendarDateParts,
  formatCalendarDate,
  formatWeekday,
  formatDayAndMonth,
  formatDayList,
} from "../../shared/format-date";
import { formatNumber } from "../../shared/format-number";
import type { EventFormsResponse } from "../shared/types";
import { IconClock } from "../ui/MediaIcons";
import { AttendanceIcon } from "./AttendanceIcon";
import type { FieldControlProps } from "../ui/Field";

type EventDay = EventFormsResponse["eventDays"][number];
type AttendanceOptionRead = EventDay["attendanceOptions"][number];

/** The value a controlled picker reports for "not attending this day". */
export const NOT_ATTENDING = "";

/** What choosing a full option means: a badge on the option, and a line under the day once it is chosen. */
export const ATTENDANCE_WAITLIST_COPY = {
  badge: "Waitlist",
  line: (option: string) => `${option} is full on this day. Choosing it joins the waitlist.`,
} as const;

interface DayAttendancePickerProps {
  control?: FieldControlProps;
  days: EventFormsResponse["eventDays"];
  lowCapacityThreshold?: number;
  value?: Readonly<Record<string, string>>;
  onChange?: (dayDate: string, attendanceType: string) => void;
}

type MatrixRow = { option: AttendanceOptionRead } | { day: EventDay };
const full = (option: AttendanceOptionRead) =>
  option.spotsRemainingPercent != null && option.spotsRemainingPercent <= 0;

function DayHeading({ day, compact }: { day: EventDay; compact: boolean }) {
  return (
    <span class="pk-attendance-matrix__date">
      <strong>{compact ? calendarDateParts(day.dayDate).weekday : formatWeekday(day.dayDate)}</strong>
      <span>{compact ? formatDayAndMonth(day.dayDate) : formatCalendarDate(day.dayDate, "long")}</span>
    </span>
  );
}

/** One full-cell target, shared by both table orientations. */
function MatrixCell({
  day,
  row,
  selected,
  id,
  threshold,
  onSelect,
}: {
  day: EventDay;
  row: AttendanceOptionRead;
  selected: boolean;
  id: string;
  threshold: number;
  onSelect: () => void;
}) {
  const option = row.value === NOT_ATTENDING ? row : day.attendanceOptions.find((option) => option.value === row.value);
  if (!option)
    return (
      <span class="pk-attendance-matrix__unavailable">
        <span class="pk-attendance-matrix__desktop" aria-hidden="true">
          Not offered
        </span>
        <span class="pk-attendance-matrix__mobile" aria-hidden="true">
          –
        </span>
        <span class="pk-sr-only">Not offered that day</span>
      </span>
    );
  const waiting = full(option);
  const limited =
    !waiting && threshold > 0 && option.spotsRemainingPercent != null && option.spotsRemainingPercent <= threshold;
  return (
    <div class="pk-attendance-matrix__cell" data-selected={selected || undefined} data-waitlist={waiting || undefined}>
      <Radio
        class="pk-attendance-matrix__choice"
        id={`${id}-${day.dayDate}-${option.value ? `method-${option.value}` : "not-attending"}`}
        name={`dayAttendance.${day.dayDate}`}
        value={option.value}
        data-day-label={day.label?.trim() || day.dayDate}
        data-option-label={option.label}
        data-waitlist={waiting ? "" : undefined}
        checked={selected}
        onChange={onSelect}
        aria-describedby={waiting ? `${id}-waitlist-${day.dayDate}-${option.value}` : undefined}
        label={
          <>
            <span class="pk-sr-only">
              {option.label} — {day.label?.trim() || day.dayDate}
              {waiting ? " — joins waitlist" : ""}
            </span>
            {waiting && (
              <>
                <span class="pk-attendance-matrix__full-marker" aria-hidden="true">
                  <IconClock width="12" height="12" />
                </span>
              </>
            )}
            {limited && (
              <span class="pk-attendance-matrix__limited" aria-label="Limited spots remaining">
                Few left
              </span>
            )}
          </>
        }
      />
      {waiting && (
        <span class="pk-sr-only" id={`${id}-waitlist-${day.dayDate}-${option.value}`}>
          {ATTENDANCE_WAITLIST_COPY.line(option.label)}
        </span>
      )}
    </div>
  );
}

/** One selection model, projected by day on desktop and by method on longer phone schedules. */
export function DayAttendancePicker({
  control,
  days,
  lowCapacityThreshold = 0,
  value,
  onChange,
}: DayAttendancePickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const phone = useMediaQuery("(max-width: 40rem)");
  const transposed = phone && days.length > 3;
  const selected = value ?? draft;
  if (!days.length) return <p class="pk-small">No per-day attendance required for this event.</p>;
  const unique = new Map<string, AttendanceOptionRead>();
  for (const day of days)
    for (const option of day.attendanceOptions) if (!unique.has(option.value)) unique.set(option.value, option);
  const options: AttendanceOptionRead[] = [
    ...unique.values(),
    { value: NOT_ATTENDING, label: "Not attending", description: "Skip this day", icon: "none" },
  ];
  const fullDays = (option: AttendanceOptionRead) =>
    days.filter((day) =>
      day.attendanceOptions.some((candidate) => candidate.value === option.value && full(candidate)),
    );
  const waiting = days.filter((day) =>
    day.attendanceOptions.some((option) => option.value === selected[day.dayDate] && full(option)),
  );
  const hasUnavailable = days.some((day) =>
    options.some(
      (option) =>
        option.value !== NOT_ATTENDING && !day.attendanceOptions.some((offered) => offered.value === option.value),
    ),
  );
  const hasFull = options.some((option) => fullDays(option).length > 0);
  function select(day: EventDay, option: AttendanceOptionRead) {
    if (onChange) onChange(day.dayDate, option.value);
    else setDraft((current) => ({ ...current, [day.dayDate]: option.value }));
  }
  function selectEveryDay(option: AttendanceOptionRead) {
    for (const day of days) {
      if (option.value !== NOT_ATTENDING && !day.attendanceOptions.some((offered) => offered.value === option.value))
        continue;
      const input = Array.from(root.current?.querySelectorAll<HTMLInputElement>("input[type=radio]") ?? []).find(
        (input) => input.name === `dayAttendance.${day.dayDate}` && input.value === option.value,
      );
      input?.click();
    }
  }
  const cell = (day: EventDay, option: AttendanceOptionRead) => (
    <MatrixCell
      day={day}
      row={option}
      selected={selected[day.dayDate] === option.value}
      id={id}
      threshold={lowCapacityThreshold}
      onSelect={() => select(day, option)}
    />
  );
  const columns: DataTableColumn<MatrixRow>[] = transposed
    ? [
        {
          id: "day",
          header: "Day",
          headerHidden: true,
          cell: (row) => ("day" in row ? <DayHeading day={row.day} compact={phone} /> : null),
        },
        ...options.map((option): DataTableColumn<MatrixRow> => ({
          id: `method:${option.value}`,
          header: option.label,
          headerContent: (
            <Button
              variant="ghost"
              class="pk-attendance-matrix__mode-button"
              aria-label={`Choose ${option.label} for every available day`}
              title={option.label}
              onClick={() => selectEveryDay(option)}
            >
              <AttendanceIcon type={option.value} icon={option.icon} />
              <span>{option.label}</span>
            </Button>
          ),
          align: "center",
          cell: (row) => ("day" in row ? cell(row.day, option) : null),
        })),
      ]
    : [
        {
          id: "method",
          header: "Attendance",
          headerHidden: true,
          cell: (row) => {
            if (!("option" in row)) return null;
            const { option } = row;
            const unavailable = fullDays(option);
            return (
              <div class="pk-attendance-matrix__method">
                <AttendanceIcon type={option.value} icon={option.icon} />
                <div>
                  <strong>{option.label}</strong>
                  {option.description && (
                    <p class="pk-small pk-muted pk-attendance-matrix__description">{option.description}</p>
                  )}
                  {unavailable.length > 0 && (
                    <p class="pk-attendance-matrix__full">
                      {unavailable.length === days.length
                        ? "Full on all days"
                        : unavailable.length > 7
                          ? `Full on ${formatNumber(unavailable.length)} days`
                          : `Full on ${formatDayList(
                              unavailable.map((day) => day.dayDate),
                              { includeDates: days.length > 7, weekday: "long" },
                            )}`}
                    </p>
                  )}
                </div>
              </div>
            );
          },
        },
        ...days.map((day): DataTableColumn<MatrixRow> => ({
          id: day.dayDate,
          header: day.label?.trim() || formatDayAndMonth(day.dayDate),
          headerContent: <DayHeading day={day} compact={phone} />,
          align: "center",
          cell: (row) => ("option" in row ? cell(day, row.option) : null),
        })),
      ];
  return (
    <div
      class="pk-attendance-matrix pk-stack"
      data-transposed={transposed || undefined}
      ref={root}
      id={control?.id}
      role="group"
      aria-label="Attendance choices"
      aria-invalid={control?.["aria-invalid"]}
      aria-describedby={control?.["aria-describedby"]}
      tabIndex={control?.["aria-invalid"] ? -1 : undefined}
    >
      <p class="pk-small">
        {transposed
          ? "Pick one option per day. Tap a mode’s column header to use it for every available day."
          : "Pick one option per day. Click an option’s name to use it for every available day."}
      </p>
      <DataTable
        caption="Attendance by day"
        narrowLayout="columns"
        columns={columns}
        rows={transposed ? days.map((day) => ({ day })) : options.map((option) => ({ option }))}
        rowKey={(row) => ("day" in row ? `day:${row.day.dayDate}` : `method:${row.option.value}`)}
        rowAction={
          transposed
            ? undefined
            : (row) =>
                "option" in row
                  ? {
                      label: `Choose ${row.option.label} for every available day`,
                      onSelect: () => selectEveryDay(row.option),
                    }
                  : undefined
        }
      />
      {(hasFull || hasUnavailable) && (
        <p class="pk-attendance-matrix__legend">
          {hasFull && (
            <>
              <IconClock width="14" height="14" /> Full · joins waitlist
            </>
          )}
          {hasUnavailable && <span>– Not offered that day</span>}
        </p>
      )}
      {waiting.length > 0 && (
        <Alert
          tone="warn"
          title={
            waiting.length > 7
              ? `Waitlist for ${formatNumber(waiting.length)} selected days`
              : `Waitlist: ${formatDayList(
                  waiting.map((day) => day.dayDate),
                  { includeDates: days.length > 7, weekday: "long" },
                )}`
          }
        >
          We’ll email you when a seat opens.
          {waiting.every(
            (day) =>
              selected[day.dayDate] === "in_person" &&
              day.attendanceOptions.some((option) => option.value === "virtual"),
          ) && " You can watch live online while you wait."}
        </Alert>
      )}
    </div>
  );
}
