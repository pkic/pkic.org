import { eventDayOptionAccessSql } from "../event-attendance-option-sql";

/** Attendance transitions use configured access modes, independently of option identifiers. */
export function physicalAttendanceTransitionSql(direction: "left" | "joined", history: string, day: string): string {
  const from = eventDayOptionAccessSql(day, `${history}.from_type`);
  const to = eventDayOptionAccessSql(day, `${history}.to_type`);
  const current = eventDayOptionAccessSql(day, "current_day.attendance_type");
  const held = `EXISTS (SELECT 1 FROM registration_day_attendance current_day
    WHERE current_day.registration_id = ${history}.registration_id AND current_day.event_day_id = ${history}.event_day_id
      AND ${current} = 'physical')`;
  return direction === "left"
    ? `(${from} = 'physical' AND ${to} <> 'physical' AND NOT ${held})`
    : `(${from} <> 'physical' AND ${to} = 'physical' AND ${held})`;
}
