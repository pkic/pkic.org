import { LEGACY_ATTENDANCE_ACCESS } from "../../../assets/shared/event-attendance-access";

/** Organizer-defined label for one day's selected option; arguments are trusted SQL expressions. */
export function attendanceOptionLabelSql(day: string, value: string): string {
  return `(SELECT CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.label') END
    FROM json_each(CASE WHEN json_valid(${day}.attendance_options_json) THEN ${day}.attendance_options_json ELSE '[]' END) option
    WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.value') END = ${value} LIMIT 1)`;
}

/** Whether a selected day currently occupies its option's capacity. Arguments are trusted SQL expressions. */
export function registrationDayHoldsOptionSql(attendance: string, now: string): string {
  return `NOT EXISTS (SELECT 1 FROM event_day_waitlist_entries capacity_waiting
    WHERE capacity_waiting.registration_id = ${attendance}.registration_id
      AND capacity_waiting.event_day_id = ${attendance}.event_day_id
      AND (capacity_waiting.status IN ('waiting', 'expired') OR (capacity_waiting.status = 'offered'
        AND capacity_waiting.offer_expires_at IS NOT NULL AND capacity_waiting.offer_expires_at <= ${now})))`;
}

const legacyAccessCases = Object.entries(LEGACY_ATTENDANCE_ACCESS)
  .map(([value, mode]) => `WHEN '${value}' THEN '${mode}'`)
  .join(" ");

/** Resolve configured access using trusted SQL expressions. */
export function eventDayOptionAccessSql(day: string, attendanceType: string) {
  return `COALESCE((SELECT CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.accessMode') END
    FROM json_each(CASE WHEN json_valid(${day}.attendance_options_json) THEN ${day}.attendance_options_json ELSE '[]' END) option
    WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.value') END = ${attendanceType} LIMIT 1),
    CASE ${attendanceType} ${legacyAccessCases} ELSE 'none' END)`;
}
