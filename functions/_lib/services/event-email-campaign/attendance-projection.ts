import { all } from "../../db/queries";
import { stringifyJson } from "../../utils/json";
import type { DatabaseLike } from "../../types";
import type {
  AttendeeDayAttendance,
  AttendeeDayAttendanceRow,
  AttendeeDayProjections,
  AttendeeDayWaitlist,
  AttendeeDayWaitlistRow,
} from "./types";

function indexAttendanceRows(rows: AttendeeDayAttendanceRow[]): Map<string, AttendeeDayAttendance[]> {
  const byRegistration = new Map<string, AttendeeDayAttendance[]>();
  for (const row of rows) {
    const entries = byRegistration.get(row.registration_id) ?? [];
    entries.push({ dayDate: row.dayDate, attendanceType: row.attendanceType, label: row.label });
    byRegistration.set(row.registration_id, entries);
  }
  return byRegistration;
}

function indexWaitlistRows(rows: AttendeeDayWaitlistRow[]): Map<string, AttendeeDayWaitlist[]> {
  const byRegistration = new Map<string, AttendeeDayWaitlist[]>();
  for (const row of rows) {
    const entries = byRegistration.get(row.registration_id) ?? [];
    entries.push({ dayDate: row.dayDate, status: row.status });
    byRegistration.set(row.registration_id, entries);
  }
  return byRegistration;
}

async function listDayAttendance(
  db: DatabaseLike,
  registrationIdsJson: string,
): Promise<Map<string, AttendeeDayAttendance[]>> {
  const rows = await all<AttendeeDayAttendanceRow>(
    db,
    `SELECT rda.registration_id,
            ed.day_date AS dayDate,
            rda.attendance_type AS attendanceType,
            ed.label AS label
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     WHERE rda.registration_id IN (SELECT value FROM json_each(?))
     ORDER BY rda.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
    [registrationIdsJson],
  );
  return indexAttendanceRows(rows);
}

async function listDayWaitlist(
  db: DatabaseLike,
  registrationIdsJson: string,
): Promise<Map<string, AttendeeDayWaitlist[]>> {
  const rows = await all<AttendeeDayWaitlistRow>(
    db,
    `SELECT w.registration_id,
            ed.day_date AS dayDate,
            w.status AS status
     FROM event_day_waitlist_entries w
     JOIN event_days ed ON ed.id = w.event_day_id
     WHERE w.registration_id IN (SELECT value FROM json_each(?))
       AND w.status IN ('waiting', 'offered', 'accepted')
     ORDER BY w.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
    [registrationIdsJson],
  );
  return indexWaitlistRows(rows);
}

export async function projectAttendeeDayState(
  db: DatabaseLike,
  registrationIds: readonly string[],
): Promise<AttendeeDayProjections> {
  if (registrationIds.length === 0) {
    return { attendanceByRegistration: new Map(), waitlistByRegistration: new Map() };
  }

  const registrationIdsJson = stringifyJson(registrationIds);
  const [attendanceByRegistration, waitlistByRegistration] = await Promise.all([
    listDayAttendance(db, registrationIdsJson),
    listDayWaitlist(db, registrationIdsJson),
  ]);
  return { attendanceByRegistration, waitlistByRegistration };
}
