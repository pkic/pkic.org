import { all } from "../db/queries";
import { AppError } from "../errors";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike, StatementLike } from "../types";
import type { AttendanceType } from "../../../assets/shared/schemas/registration";

// Open-ended: any string that matches a configured attendance option value.
export type DayAttendanceType = string;

/** A single configurable attendance option for an event day. */
export interface AttendanceOption {
  value: string;
  label: string;
  /** null / absent means unlimited capacity for this option. */
  capacity?: number | null;
}

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

/**
 * Parses the attendance options for a day from its JSON column.
 * Falls back to a legacy default (in_person + on_demand) using the
 * in_person_capacity column when no options have been configured.
 */
export function resolveAttendanceOptions(
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
  // Legacy default: in-person (capped) + on-demand (unlimited)
  return [
    { value: "in_person", label: "In-person", capacity: day.in_person_capacity ?? null },
    { value: "on_demand", label: "On-demand", capacity: null },
  ];
}

export async function listEventDays(db: DatabaseLike, eventId: string): Promise<EventDayRecord[]> {
  return all<EventDayRecord>(
    db,
    `SELECT id, event_id, day_date, label, starts_at, ends_at, in_person_capacity, sort_order,
            attendance_options_json, capacity_revision
     FROM event_days
     WHERE event_id = ?
     ORDER BY sort_order ASC, day_date ASC`,
    [eventId],
  );
}

/** Admin projection with registered attendance counts grouped in D1, not in the browser. */
export async function listAdminEventDaysWithCounts(db: DatabaseLike, eventId: string) {
  const [days, counts] = await Promise.all([
    listEventDays(db, eventId),
    all<{ event_day_id: string; attendance_type: string; count: number }>(
      db,
      `SELECT rda.event_day_id, rda.attendance_type, COUNT(*) AS count
       FROM registration_day_attendance rda
       JOIN registrations r ON r.id = rda.registration_id
       WHERE r.event_id = ? AND r.status = 'registered'
       GROUP BY rda.event_day_id, rda.attendance_type`,
      [eventId],
    ),
  ]);
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
    attendanceOptions: resolveAttendanceOptions(day),
    attendanceCounts: countByDay.get(day.id) ?? {},
  }));
}

export async function getRegistrationDayAttendance(
  db: DatabaseLike,
  registrationId: string,
): Promise<Array<{ dayDate: string; attendanceType: DayAttendanceType; label: string | null }>> {
  return all<{ dayDate: string; attendanceType: DayAttendanceType; label: string | null }>(
    db,
    `SELECT ed.day_date AS dayDate, rda.attendance_type AS attendanceType, ed.label AS label
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     WHERE rda.registration_id = ?
     ORDER BY ed.sort_order ASC, ed.day_date ASC`,
    [registrationId],
  );
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
  const rows = await all<{ event_day_id: string; attendance_type: string; total: number }>(
    db,
    `SELECT rda.event_day_id, rda.attendance_type, COUNT(*) AS total
     FROM registration_day_attendance rda
     JOIN registrations r ON r.id = rda.registration_id
     WHERE r.event_id = ?
       AND r.status IN ('pending_email_confirmation', 'registered')
     GROUP BY rda.event_day_id, rda.attendance_type`,
    [eventId],
  );
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.event_day_id)) map.set(row.event_day_id, new Map());
    map.get(row.event_day_id)!.set(row.attendance_type, Number(row.total));
  }
  return map;
}

export async function replaceRegistrationDayAttendance(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    selections?: DayAttendanceSelection[];
    changedBy?: string;
    recordHistory?: boolean;
    configuredEventDays?: EventDayRecord[];
  },
): Promise<void> {
  const statements = await prepareReplaceRegistrationDayAttendanceStatements(db, payload);
  if (statements.length > 0) await db.batch(statements);
}

export async function prepareReplaceRegistrationDayAttendanceStatements(
  db: DatabaseLike,
  payload: {
    registrationId: string;
    eventId: string;
    selections?: DayAttendanceSelection[];
    changedBy?: string;
    recordHistory?: boolean;
    configuredEventDays?: EventDayRecord[];
  },
): Promise<StatementLike[]> {
  const selections = normalizeSelections(payload.selections);
  const previousRows = await all<{ event_day_id: string; attendance_type: string }>(
    db,
    "SELECT event_day_id, attendance_type FROM registration_day_attendance WHERE registration_id = ?",
    [payload.registrationId],
  );
  const previousByDayId = new Map(previousRows.map((row) => [row.event_day_id, row.attendance_type]));

  const eventDays = payload.configuredEventDays ?? (await listEventDays(db, payload.eventId));
  const dayMap = new Map(eventDays.map((day) => [day.day_date, day]));
  const nextByDayId = new Map<string, string>();

  for (const selection of selections) {
    const day = dayMap.get(selection.dayDate);
    if (!day) {
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${selection.dayDate}' is not configured for this event`);
    }

    nextByDayId.set(day.id, selection.attendanceType);
  }

  const now = nowIso();
  const statements = [
    db.prepare("DELETE FROM registration_day_attendance WHERE registration_id = ?").bind(payload.registrationId),
  ];
  for (const selection of selections) {
    const day = dayMap.get(selection.dayDate);
    if (!day) continue;

    statements.push(
      db
        .prepare(
          `INSERT INTO registration_day_attendance (
             id, registration_id, event_day_id, attendance_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), payload.registrationId, day.id, selection.attendanceType, now, now),
    );
  }

  if (payload.recordHistory !== false) {
    const changedBy = payload.changedBy ?? "system";
    const allDayIds = new Set([...previousByDayId.keys(), ...nextByDayId.keys()]);
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

  if (statements.length === 1 && selections.length === 0 && previousByDayId.size === 0) return [];
  return statements;
}
