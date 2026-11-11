import type { EventDay } from "../../../shared/schemas/event-configuration";
import type { RegistrationDayState } from "../../../shared/schemas/event-registrations";
import { formatNumber } from "../../../shared/format-number";
import { formatDayAndMonth } from "../../../shared/format-date";
import { attendanceTypeLabel } from "../../shared/attendance";
import type { Column } from "../Table";
import { IconBadge } from "../../ui/Badge";

import { AttendanceIcon } from "../AttendanceIcon";
import { attendanceIconName } from "../../../shared/event-attendance-icons";

/** Attendance filters belong to the roster columns, with shared server query names. */
export function registrationAttendanceColumns<Row extends { days: RegistrationDayState[] }>(
  days: readonly Pick<EventDay, "date" | "label" | "attendanceOptions">[],
  filters: Readonly<Record<string, string>> = {},
): Column<Row>[] {
  const options = new Map<string, EventDay["attendanceOptions"][number]>();
  for (const day of days)
    for (const option of day.attendanceOptions) {
      const previous = options.get(option.value);
      options.set(option.value, previous ? { ...option, ...previous, icon: previous.icon ?? option.icon } : option);
    }
  const colors = ["blue", "teal", "purple"] as const;
  const typeColors = new Map([...options.keys()].map((type, i) => [type, colors[i % colors.length]]));
  const selectedDates = filters.day_dates ? new Set(filters.day_dates.split(",")) : null;
  const selectedTypes = filters.attendance_type ? new Set(filters.attendance_type.split(",")) : null;
  const typeLabel = (type: string) => options.get(type)?.label ?? attendanceTypeLabel(type);
  // Summarize only this row's day details; list membership is always filtered by D1.
  const matchingDays = (row: Row) =>
    row.days
      .filter((day) => {
        const waiting = day.waitlistStatus === "waiting" || day.waitlistStatus === "offered";
        return (
          day.attendanceType !== "not_attending" &&
          (!selectedDates || selectedDates.has(day.dayDate)) &&
          (!selectedTypes || selectedTypes.has(day.attendanceType)) &&
          (!filters.waitlisted || waiting === (filters.waitlisted === "true"))
        );
      })
      .sort((a, b) => a.dayDate.localeCompare(b.dayDate));
  return [
    {
      header: "Attendance",
      width: "fit",
      cell: (registration) => {
        const grouped = new Map<string, RegistrationDayState[]>();
        for (const day of matchingDays(registration)) {
          const group = grouped.get(day.attendanceType) ?? [];
          group.push(day);
          grouped.set(day.attendanceType, group);
        }
        return grouped.size ? (
          <span class="pk-badge-group">
            {[...grouped].map(([type, attending]) => {
              const option = options.get(type);
              const name = option?.label ?? attending[0]?.optionLabel ?? attendanceTypeLabel(type);
              const waiting = attending.filter(
                (day) => day.waitlistStatus === "waiting" || day.waitlistStatus === "offered",
              );
              const total = attending.length;
              const label = `${name}: ${formatNumber(total)} ${total === 1 ? "day" : "days"} total; ${formatNumber(total - waiting.length)} not waitlisted${waiting.length ? `; ${formatNumber(waiting.length)} of these ${waiting.length === 1 ? "is" : "are"} waitlisted` : ""}. ${attending.map((day) => `${formatDayAndMonth(day.dayDate)}${day.waitlistStatus === "waiting" || day.waitlistStatus === "offered" ? ` (${day.waitlistStatus})` : ""}`).join(", ")}`;
              return (
                <IconBadge
                  key={type}
                  icon={
                    attendanceIconName(type, option?.icon) === "none" ? (
                      name
                    ) : (
                      <AttendanceIcon type={type} icon={option?.icon} />
                    )
                  }
                  label={label}
                  tooltip={
                    <div class="pk-stack pk-stack--tight">
                      <strong>{name}</strong>
                      <span>
                        {formatNumber(total - waiting.length)} not waitlisted · {formatNumber(waiting.length)}{" "}
                        waitlisted
                      </span>
                      {attending.map((day) => (
                        <span key={day.dayDate}>
                          {formatDayAndMonth(day.dayDate)} ·{" "}
                          {day.waitlistStatus === "waiting"
                            ? "Waitlisted"
                            : day.waitlistStatus === "offered"
                              ? "Place offered"
                              : day.waitlistStatus === "expired"
                                ? "Offer expired"
                                : "Not waitlisted"}
                        </span>
                      ))}
                    </div>
                  }
                  count={total}
                  color={typeColors.get(type)}
                  fillFraction={(total - waiting.length) / total}
                />
              );
            })}
          </span>
        ) : (
          "—"
        );
      },
      filters: [
        {
          label: "Attendance type",
          param: "attendance_type",
          multiple: true,
          formatSummary: (values, mode) =>
            values.length > 1
              ? `${mode === "all" ? "All" : "Any"}: ${values.map(typeLabel).join(", ")}`
              : values.map(typeLabel).join(", "),
          match: {
            param: "attendance_match",
            options: [
              { value: "", label: "Any selected type" },
              { value: "all", label: "All selected types" },
            ],
          },
          options: [
            { value: "", label: "All types" },
            ...[...options].map(([value, option]) => ({ value, label: option.label })),
          ],
        },
        {
          label: "Days",
          param: "day_dates",
          multiple: true,
          formatSummary: (values, mode) =>
            values.length > 3
              ? `${mode === "all" ? "All" : "Any"} of ${formatNumber(values.length)} days`
              : `${mode === "all" ? "All" : "Any"}: ${values.map(formatDayAndMonth).join(", ")}`,
          match: {
            param: "day_match",
            options: [
              { value: "", label: "Any selected day" },
              { value: "all", label: "All selected days" },
            ],
          },
          options: [
            { value: "", label: "All days" },
            ...[...days]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((day) => ({ value: day.date, label: formatDayAndMonth(day.date) })),
          ],
        },
        {
          label: "Waitlist",
          param: "waitlisted",
          options: [
            { value: "", label: "Any waitlist status" },
            { value: "true", label: "On a day waitlist" },
            { value: "false", label: "Not waitlisted" },
          ],
        },
      ],
    },
  ];
}
