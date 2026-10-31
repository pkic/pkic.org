import { eventReadIdSql, type EventReadSelection } from "./events/selection";
import { registrationReadIdSql, type RegistrationReadSelection } from "./registrations/selection";
import { batchRows } from "../db/pagination";
import { prepareParticipationReconciliation } from "./event-participation/reconciliation";
import { AppError } from "../errors";
import { attendanceMethodName, dayAttendanceTypeNotConfiguredError, dayNotConfiguredError } from "./event-day-refusals";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike, StatementLike } from "../types";
import type { AttendanceType } from "../../../assets/shared/schemas/registration";
import type { EventAttendanceOption } from "../../../assets/shared/schemas/event-configuration";

// Open-ended: any string that matches a configured attendance option value.
export type DayAttendanceType = string;

/** A single configurable attendance option for an event day. */
export type AttendanceOption = EventAttendanceOption;

export interface EventDayRecord {
  id: string;
  event_id: string;
  day_date: string;
  label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  in_person_capacity: number | null;
  sort_order: number;
  attendance_options_json: string | null;
  capacity_revision: number;
}

export interface DayAttendanceSelection {
  dayDate: string;
  attendanceType: DayAttendanceType;
}

function eventDaysListSql(eventIdSql: string) {
  return `SELECT id, event_id, day_date, label, starts_at, ends_at, in_person_capacity, sort_order,
  attendance_options_json, capacity_revision
  FROM event_days
  WHERE event_id = ${eventIdSql}
  ORDER BY sort_order ASC, day_date ASC`;
}

/**
 * Parses the attendance options for a day from its JSON column.
 * Falls back to the legacy core options using the
 * in_person_capacity column when no options have been configured.
 */
export function configuredAttendanceOptions(
  day: Pick<EventDayRecord, "attendance_options_json" | "in_person_capacity">,
): AttendanceOption[] {
  if (day.attendance_options_json) {
    try {
      const parsed = JSON.parse(day.attendance_options_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as AttendanceOption[];
      }
    } catch {
      // fall through to legacy default
    }
  }
  // Legacy default: the three core modes, with capacity applying only in person.
  return [
    { value: "in_person", label: "In-person", capacity: day.in_person_capacity ?? null },
    { value: "virtual", label: "Virtual", capacity: null },
    { value: "on_demand", label: "On-demand", capacity: null },
  ];
}

/** Choices currently offered to new registrants; disabled definitions remain available to management. */
export function resolveAttendanceOptions(
  day: Pick<EventDayRecord, "attendance_options_json" | "in_person_capacity">,
): AttendanceOption[] {
  return configuredAttendanceOptions(day).filter((option) => option.enabled !== false);
}

/** The organizer's label for an attendance value on any day of the event, if one names it. */
export function attendanceOptionLabel(days: readonly EventDayRecord[], value: string): string | null {
  for (const day of days) {
    const option = configuredAttendanceOptions(day).find((candidate) => candidate.value === value);
    if (option) return option.label;
  }
  return null;
}

export async function listEventDays(db: DatabaseLike, eventId: string): Promise<EventDayRecord[]> {
  return (await prepareEventDays(db, eventId).all<EventDayRecord>()).results;
}

export function prepareEventDays(db: DatabaseLike, event: EventReadSelection) {
  const selection = eventReadIdSql(event);
  return db.prepare(eventDaysListSql(selection.sql)).bind(...selection.bindings);
}

function eventDayAttendanceCountsSql(includePendingConfirmation: boolean, eventIdSql = "?") {
  const status = includePendingConfirmation ? "IN ('pending_email_confirmation', 'registered')" : "= 'registered'";
  return `WITH selected_event AS (SELECT ${eventIdSql} AS id)
    SELECT rda.event_day_id, rda.attendance_type, COUNT(*) AS count
    FROM event_days day
    JOIN registration_day_attendance rda ON rda.event_day_id = day.id
    WHERE day.event_id = (SELECT id FROM selected_event)
      AND rda.registration_id IN (
        SELECT id FROM registrations
        WHERE event_id = (SELECT id FROM selected_event) AND status ${status}
      )
    GROUP BY rda.event_day_id, rda.attendance_type`;
}

export const CONFIGURED_EVENT_DAY_ATTENDANCE_COUNTS_SQL = eventDayAttendanceCountsSql(false);

/** Management projection with registered attendance counts grouped in D1, not in the browser. */
export async function listConfiguredEventDaysWithCounts(db: DatabaseLike, eventId: string) {
  const [daysResult, countsResult] = await db.batch([
    prepareEventDays(db, eventId),
    prepareConfiguredEventDayCounts(db, eventId),
  ]);
  return decodeConfiguredEventDays(
    batchRows<EventDayRecord>(daysResult),
    batchRows<EventDayAttendanceCountRow>(countsResult),
  );
}

export function prepareConfiguredEventDayCounts(db: DatabaseLike, event: EventReadSelection) {
  const selection = eventReadIdSql(event);
  return db.prepare(eventDayAttendanceCountsSql(false, selection.sql)).bind(...selection.bindings);
}

export function decodeConfiguredEventDays(days: EventDayRecord[], counts: EventDayAttendanceCountRow[]) {
  const countByDay = new Map<string, Record<string, number>>();
  for (const row of counts) {
    const attendanceCounts = countByDay.get(row.event_day_id) ?? {};
    attendanceCounts[row.attendance_type] = row.count;
    countByDay.set(row.event_day_id, attendanceCounts);
  }
  return days.map((day) => ({
    id: day.id,
    date: day.day_date,
    label: day.label,
    startsAt: day.starts_at,
    endsAt: day.ends_at,
    sortOrder: day.sort_order,
    attendanceOptions: configuredAttendanceOptions(day),
    attendanceCounts: countByDay.get(day.id) ?? {},
  }));
}

export interface RegistrationDayAttendanceRow {
  dayDate: string;
  attendanceType: DayAttendanceType;
  label: string | null;
  /** When the day was first held on this registration. */
  heldSince: string;
  /** When the day's attendance last changed. */
  changedAt: string;
}

export function prepareRegistrationDayAttendance(db: DatabaseLike, registrationId: string) {
  return db
    .prepare(`SELECT ed.day_date AS dayDate, rda.attendance_type AS attendanceType, ed.label AS label,
            rda.created_at AS heldSince, rda.updated_at AS changedAt
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     WHERE rda.registration_id = ?
     ORDER BY ed.sort_order ASC, ed.day_date ASC`)
    .bind(registrationId);
}

export async function getRegistrationDayAttendance(
  db: DatabaseLike,
  registrationId: string,
): Promise<RegistrationDayAttendanceRow[]> {
  return (await prepareRegistrationDayAttendance(db, registrationId).all<RegistrationDayAttendanceRow>()).results;
}

function normalizeSelections(selections?: DayAttendanceSelection[]): DayAttendanceSelection[] {
  if (!selections || selections.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: DayAttendanceSelection[] = [];
  for (const entry of selections) {
    const dayDate = entry.dayDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new AppError(400, "DAY_DATE_INVALID", `Invalid dayDate '${entry.dayDate}'`);
    }
    if (seen.has(dayDate)) {
      throw new AppError(400, "DAY_DATE_DUPLICATE", `Duplicate dayDate '${dayDate}'`);
    }
    seen.add(dayDate);
    normalized.push({ dayDate, attendanceType: entry.attendanceType });
  }
  return normalized;
}

export function deriveEventAttendanceType(selections?: DayAttendanceSelection[]): AttendanceType | null {
  if (!selections || selections.length === 0) {
    return null;
  }

  if (selections.some((entry) => entry.attendanceType === "in_person")) {
    return "in_person";
  }

  if (selections.some((entry) => entry.attendanceType === "virtual")) {
    return "virtual";
  }

  return "on_demand";
}

/**
 * Returns a single-query count of confirmed registrations per (event_day_id, attendance_type)
 * for a given event. Used by form endpoints to compute spotsRemainingPercent without N+1 queries.
 */
export async function countRegisteredByEventDay(
  db: DatabaseLike,
  eventId: string,
): Promise<Map<string, Map<string, number>>> {
  const rows = await prepareRegisteredEventDayCounts(db, eventId).all<EventDayAttendanceCountRow>();
  return decodeRegisteredEventDayCounts(rows.results);
}

export interface EventDayAttendanceCountRow {
  event_day_id: string;
  attendance_type: string;
  count: number;
}

export function prepareRegisteredEventDayCounts(db: DatabaseLike, event: EventReadSelection) {
  const selection = eventReadIdSql(event);
  return db.prepare(eventDayAttendanceCountsSql(true, selection.sql)).bind(...selection.bindings);
}

export function decodeRegisteredEventDayCounts(rows: EventDayAttendanceCountRow[]) {
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.event_day_id)) map.set(row.event_day_id, new Map());
    map.get(row.event_day_id)!.set(row.attendance_type, Number(row.count));
  }
  return map;
}

export interface RegistrationDayAttendanceChange {
  registrationId: string;
  eventId: string;
  selections?: DayAttendanceSelection[];
  changedBy?: string;
  recordHistory?: boolean;
  configuredEventDays?: EventDayRecord[];
}

export async function replaceRegistrationDayAttendance(
  db: DatabaseLike,
  payload: RegistrationDayAttendanceChange,
): Promise<void> {
  const statements = await prepareReplaceRegistrationDayAttendanceStatements(db, payload);
  if (statements.length > 0) await db.batch(statements);
}

export async function prepareReplaceRegistrationDayAttendanceStatements(
  db: DatabaseLike,
  payload: RegistrationDayAttendanceChange,
): Promise<StatementLike[]> {
  const results = await db.batch([
    preparePreviousRegistrationDayAttendance(db, { registrationId: payload.registrationId }),
    ...(payload.configuredEventDays ? [] : [prepareEventDays(db, payload.eventId)]),
  ]);
  return planRegistrationDayAttendanceChange(
    db,
    payload,
    batchRows<PreviousRegistrationDayAttendanceRow>(results[0]),
    payload.configuredEventDays ?? batchRows<EventDayRecord>(results[1]),
  );
}

export interface PreviousRegistrationDayAttendanceRow {
  event_day_id: string;
  attendance_type: string;
}

export function preparePreviousRegistrationDayAttendance(db: DatabaseLike, selection: RegistrationReadSelection) {
  const reference = registrationReadIdSql(selection);
  return db
    .prepare(
      `SELECT event_day_id,attendance_type FROM registration_day_attendance WHERE registration_id=${reference.sql}`,
    )
    .bind(...reference.bindings);
}

/** Plan from the caller's single snapshot; this builder never reads or commits. */
export function planRegistrationDayAttendanceChange(
  db: DatabaseLike,
  payload: RegistrationDayAttendanceChange,
  previousRows: PreviousRegistrationDayAttendanceRow[],
  eventDays: EventDayRecord[],
): StatementLike[] {
  const selections = normalizeSelections(payload.selections);
  const previousByDayId = new Map(previousRows.map((row) => [row.event_day_id, row.attendance_type]));

  const dayMap = new Map(eventDays.map((day) => [day.day_date, day]));
  const nextByDayId = new Map<string, string>();

  for (const selection of selections) {
    const day = dayMap.get(selection.dayDate);
    if (!day) throw dayNotConfiguredError(selection.dayDate);
    // A day the registration keeps as it holds it is not re-judged. The
    // whole roster is resent with every change, so checking an untouched day
    // against options the organizer narrowed after it was taken refused the
    // change of an unrelated day — moving a speaker's first day to virtual
    // failed because of their second.
    const unchanged = previousByDayId.get(day.id) === selection.attendanceType;
    if (!unchanged && !resolveAttendanceOptions(day).some((option) => option.value === selection.attendanceType)) {
      throw dayAttendanceTypeNotConfiguredError(
        day,
        attendanceMethodName(selection.attendanceType, attendanceOptionLabel(eventDays, selection.attendanceType)),
      );
    }

    nextByDayId.set(day.id, selection.attendanceType);
  }

  const allDayIds = new Set([...previousByDayId.keys(), ...nextByDayId.keys()]);
  if (
    allDayIds.size === previousByDayId.size &&
    [...allDayIds].every((dayId) => previousByDayId.get(dayId) === nextByDayId.get(dayId))
  ) {
    return [];
  }

  // Only the days that change are written. Rewriting the whole roster —
  // delete every row, insert every row — gave each day the timestamp of the
  // registration's last change rather than its own, so a record could not
  // say when one day was added or last moved (#113). A day that stays as it
  // was keeps its row, its `created_at` (when it was first held) and its
  // `updated_at` (when it last changed).
  const now = nowIso();
  const statements: StatementLike[] = [];
  for (const dayId of previousByDayId.keys()) {
    if (nextByDayId.has(dayId)) continue;
    statements.push(
      db
        .prepare("DELETE FROM registration_day_attendance WHERE registration_id = ? AND event_day_id = ?")
        .bind(payload.registrationId, dayId),
    );
  }
  for (const [dayId, attendanceType] of nextByDayId) {
    const previous = previousByDayId.get(dayId);
    if (previous === attendanceType) continue;
    statements.push(
      previous === undefined
        ? db
            .prepare(
              `INSERT INTO registration_day_attendance (
                 id, registration_id, event_day_id, attendance_type, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(uuid(), payload.registrationId, dayId, attendanceType, now, now)
        : db
            .prepare(
              `UPDATE registration_day_attendance SET attendance_type = ?, updated_at = ?
                WHERE registration_id = ? AND event_day_id = ?`,
            )
            .bind(attendanceType, now, payload.registrationId, dayId),
    );
  }

  if (payload.recordHistory !== false) {
    const changedBy = payload.changedBy ?? "system";
    for (const dayId of allDayIds) {
      const fromType = previousByDayId.get(dayId) ?? null;
      const toType = nextByDayId.get(dayId) ?? null;
      if (fromType === toType) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO registration_attendance_history (
               id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            uuid(),
            payload.registrationId,
            dayId,
            fromType ?? "not_attending",
            toType ?? "not_attending",
            changedBy,
            now,
          ),
      );
    }
  }

  statements.push(...prepareParticipationReconciliation(db, payload.eventId));
  return statements;
}
