import { all, first, run } from "../db/queries";
import { AppError } from "../errors";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

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
  in_person_capacity: number | null;
  sort_order: number;
  attendance_options_json: string | null;
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
export function resolveAttendanceOptions(day: Pick<EventDayRecord, "attendance_options_json" | "in_person_capacity">): AttendanceOption[] {
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
    `SELECT id, event_id, day_date, label, in_person_capacity, sort_order, attendance_options_json
     FROM event_days
     WHERE event_id = ?
     ORDER BY sort_order ASC, day_date ASC`,
    [eventId],
  );
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

export function deriveEventAttendanceType(
  selections?: DayAttendanceSelection[],
): "in_person" | "virtual" | "on_demand" | null {
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

export async function enforceDayCapacity(
  db: DatabaseLike,
  payload: {
    eventId: string;
    selections?: DayAttendanceSelection[];
    excludeRegistrationId?: string;
  },
): Promise<void> {
  const selections = normalizeSelections(payload.selections);
  if (selections.length === 0) {
    return;
  }

  const eventDays = await listEventDays(db, payload.eventId);
  if (eventDays.length === 0) {
    return;
  }

  const dayMap = new Map(eventDays.map((day) => [day.day_date, day]));

  for (const selection of selections) {
    const day = dayMap.get(selection.dayDate);
    if (!day) {
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${selection.dayDate}' is not configured for this event`);
    }

    const options = resolveAttendanceOptions(day);
    const allowedValues = options.map((o) => o.value);
    if (!allowedValues.includes(selection.attendanceType)) {
      throw new AppError(
        400,
        "ATTENDANCE_TYPE_INVALID",
        `Attendance type '${selection.attendanceType}' is not a valid option for ${selection.dayDate}. Allowed: ${allowedValues.join(", ")}`,
        { dayDate: selection.dayDate, attendanceType: selection.attendanceType, allowedValues },
      );
    }

    const chosenOption = options.find((o) => o.value === selection.attendanceType);
    const capacity = chosenOption?.capacity ?? null;
    if (capacity === null || capacity <= 0) {
      // unlimited or not enforced
      continue;
    }

    const row = await first<{ total: number }>(
      db,
      `SELECT COUNT(*) AS total
       FROM registration_day_attendance rda
       JOIN registrations r ON r.id = rda.registration_id
       WHERE r.event_id = ?
         AND rda.event_day_id = ?
         AND rda.attendance_type = ?
         AND r.status IN ('pending_email_confirmation', 'registered')
         AND (? IS NULL OR r.id <> ?)`,
      [payload.eventId, day.id, selection.attendanceType, payload.excludeRegistrationId ?? null, payload.excludeRegistrationId ?? null],
    );

    const total = Number(row?.total ?? 0);
    if (total >= capacity) {
      throw new AppError(409, "DAY_CAPACITY_REACHED", `Capacity reached for '${selection.attendanceType}' on ${selection.dayDate}`, {
        dayDate: selection.dayDate,
        attendanceType: selection.attendanceType,
        capacity,
      });
    }
  }
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
  },
): Promise<void> {
  const selections = normalizeSelections(payload.selections);
  await run(db, "DELETE FROM registration_day_attendance WHERE registration_id = ?", [payload.registrationId]);
  if (selections.length === 0) {
    return;
  }

  const eventDays = await listEventDays(db, payload.eventId);
  const dayMap = new Map(eventDays.map((day) => [day.day_date, day]));

  for (const selection of selections) {
    const day = dayMap.get(selection.dayDate);
    if (!day) {
      throw new AppError(400, "DAY_NOT_CONFIGURED", `Day '${selection.dayDate}' is not configured for this event`);
    }

    await run(
      db,
      `INSERT INTO registration_day_attendance (
        id, registration_id, event_day_id, attendance_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), payload.registrationId, day.id, selection.attendanceType, nowIso(), nowIso()],
    );
  }
}
