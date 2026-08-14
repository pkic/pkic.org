import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export interface AttendanceStatusCount {
  accepted: number;
  waitlisted: number;
}

interface AttendanceStatusRow {
  attendance_type: string | null;
  accepted: number;
  waitlisted: number;
}

interface AttendanceChangeSummaryRow {
  day_changes: number;
  changed_attendees: number;
  left_in_person_attendees: number;
  left_in_person_day_changes: number;
  joined_in_person_attendees: number;
  joined_in_person_day_changes: number;
}

interface AttendanceChangeTransitionRow {
  from_type: string;
  to_type: string;
  attendees: number;
  day_changes: number;
}

interface AttendanceChangeDayRow {
  day_date: string;
  label: string | null;
  sort_order: number;
  changed_attendees: number;
  day_changes: number;
  left_in_person_attendees: number;
  joined_in_person_attendees: number;
}

interface RecentAttendanceChangeRow {
  registration_id: string;
  changed_at: string;
  day_date: string;
  day_label: string | null;
  from_type: string;
  to_type: string;
  user_email: string | null;
  display_name: string | null;
}

export interface AttendanceChangeStatistics {
  dayChanges: number;
  changedAttendees: number;
  leftInPersonAttendees: number;
  leftInPersonDayChanges: number;
  joinedInPersonAttendees: number;
  joinedInPersonDayChanges: number;
  byTransition: AttendanceChangeTransitionRow[];
  byDay: AttendanceChangeDayRow[];
  recent: Array<
    Omit<RecentAttendanceChangeRow, "day_date" | "day_label"> & {
      days: Array<{ day_date: string; label: string | null }>;
    }
  >;
}

/**
 * Split registered attendees by whether they still have an active day waitlist.
 * A registration is waitlisted until every requested day has either been
 * accepted or removed from the active queue.
 */
export async function getAttendanceStatusByType(
  db: DatabaseLike,
  eventId: string,
): Promise<Record<string, AttendanceStatusCount>> {
  const rows = await all<AttendanceStatusRow>(
    db,
    `SELECT r.attendance_type,
            SUM(CASE WHEN active_waitlist.registration_id IS NULL THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN active_waitlist.registration_id IS NULL THEN 0 ELSE 1 END) AS waitlisted
     FROM registrations r
     LEFT JOIN (
       SELECT DISTINCT registration_id
       FROM event_day_waitlist_entries
       WHERE event_id = ? AND status IN ('waiting', 'offered')
     ) active_waitlist ON active_waitlist.registration_id = r.id
     WHERE r.event_id = ? AND r.status = 'registered'
     GROUP BY r.attendance_type`,
    [eventId, eventId],
  );

  return Object.fromEntries(
    rows.map((row) => [
      row.attendance_type ?? "not_attending",
      { accepted: Number(row.accepted ?? 0), waitlisted: Number(row.waitlisted ?? 0) },
    ]),
  );
}

export async function getAttendanceChangeStatistics(
  db: DatabaseLike,
  eventId: string,
): Promise<AttendanceChangeStatistics> {
  const [summaryRows, transitionRows, byDayRows, recentRows] = await Promise.all([
    all<AttendanceChangeSummaryRow>(
      db,
      `SELECT COUNT(*) AS day_changes,
              COUNT(DISTINCT h.registration_id) AS changed_attendees,
              COUNT(DISTINCT CASE
                WHEN h.from_type = 'in_person' AND COALESCE(h.to_type, 'not_attending') <> 'in_person'
                  AND COALESCE(r.attendance_type, '') <> 'in_person' THEN h.registration_id
              END) AS left_in_person_attendees,
              SUM(CASE
                WHEN h.from_type = 'in_person' AND COALESCE(h.to_type, 'not_attending') <> 'in_person'
                  AND COALESCE(r.attendance_type, '') <> 'in_person' THEN 1 ELSE 0
              END) AS left_in_person_day_changes,
              COUNT(DISTINCT CASE
                WHEN COALESCE(h.from_type, 'not_attending') <> 'in_person' AND h.to_type = 'in_person'
                  AND r.attendance_type = 'in_person' THEN h.registration_id
              END) AS joined_in_person_attendees,
              SUM(CASE
                WHEN COALESCE(h.from_type, 'not_attending') <> 'in_person' AND h.to_type = 'in_person'
                  AND r.attendance_type = 'in_person' THEN 1 ELSE 0
              END) AS joined_in_person_day_changes
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       WHERE r.event_id = ?
         AND h.event_day_id IS NOT NULL
         AND h.changed_by <> 'system'
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')`,
      [eventId],
    ),
    all<AttendanceChangeTransitionRow>(
      db,
      `SELECT COALESCE(h.from_type, 'not_attending') AS from_type,
              COALESCE(h.to_type, 'not_attending') AS to_type,
              COUNT(DISTINCT h.registration_id) AS attendees,
              COUNT(*) AS day_changes
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       WHERE r.event_id = ?
         AND h.event_day_id IS NOT NULL
         AND h.changed_by <> 'system'
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
       GROUP BY COALESCE(h.from_type, 'not_attending'), COALESCE(h.to_type, 'not_attending')
       ORDER BY attendees DESC, day_changes DESC`,
      [eventId],
    ),
    all<AttendanceChangeDayRow>(
      db,
      `SELECT ed.day_date,
              COALESCE(ed.label, ed.day_date) AS label,
              ed.sort_order,
              COUNT(DISTINCT h.registration_id) AS changed_attendees,
              COUNT(*) AS day_changes,
              COUNT(DISTINCT CASE
                WHEN h.from_type = 'in_person' AND COALESCE(h.to_type, 'not_attending') <> 'in_person'
                  AND COALESCE(r.attendance_type, '') <> 'in_person' THEN h.registration_id
              END) AS left_in_person_attendees,
              COUNT(DISTINCT CASE
                WHEN COALESCE(h.from_type, 'not_attending') <> 'in_person' AND h.to_type = 'in_person'
                  AND r.attendance_type = 'in_person' THEN h.registration_id
              END) AS joined_in_person_attendees
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       JOIN event_days ed ON ed.id = h.event_day_id
       WHERE r.event_id = ?
         AND h.changed_by <> 'system'
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
       GROUP BY ed.id
       ORDER BY ed.sort_order ASC, ed.day_date ASC`,
      [eventId],
    ),
    all<RecentAttendanceChangeRow>(
      db,
      `SELECT h.registration_id,
              h.changed_at,
              ed.day_date,
              COALESCE(ed.label, ed.day_date) AS day_label,
              COALESCE(h.from_type, 'not_attending') AS from_type,
              COALESCE(h.to_type, 'not_attending') AS to_type,
              u.email AS user_email,
              COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       JOIN event_days ed ON ed.id = h.event_day_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ?
         AND h.changed_by <> 'system'
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
       ORDER BY h.changed_at DESC, ed.sort_order ASC
       LIMIT 200`,
      [eventId],
    ),
  ]);

  const summary = summaryRows[0] ?? {
    day_changes: 0,
    changed_attendees: 0,
    left_in_person_attendees: 0,
    left_in_person_day_changes: 0,
    joined_in_person_attendees: 0,
    joined_in_person_day_changes: 0,
  };
  const recentByChange = new Map<
    string,
    Omit<RecentAttendanceChangeRow, "day_date" | "day_label"> & {
      days: Array<{ day_date: string; label: string | null }>;
    }
  >();
  for (const row of recentRows) {
    const key = `${row.registration_id}:${row.changed_at}:${row.from_type}:${row.to_type}`;
    const existing = recentByChange.get(key);
    if (existing) {
      existing.days.push({ day_date: row.day_date, label: row.day_label });
      continue;
    }
    if (recentByChange.size >= 25) continue;
    recentByChange.set(key, {
      registration_id: row.registration_id,
      changed_at: row.changed_at,
      from_type: row.from_type,
      to_type: row.to_type,
      user_email: row.user_email,
      display_name: row.display_name,
      days: [{ day_date: row.day_date, label: row.day_label }],
    });
  }

  return {
    dayChanges: Number(summary.day_changes ?? 0),
    changedAttendees: Number(summary.changed_attendees ?? 0),
    leftInPersonAttendees: Number(summary.left_in_person_attendees ?? 0),
    leftInPersonDayChanges: Number(summary.left_in_person_day_changes ?? 0),
    joinedInPersonAttendees: Number(summary.joined_in_person_attendees ?? 0),
    joinedInPersonDayChanges: Number(summary.joined_in_person_day_changes ?? 0),
    byTransition: transitionRows.map((row) => ({
      ...row,
      attendees: Number(row.attendees ?? 0),
      day_changes: Number(row.day_changes ?? 0),
    })),
    byDay: byDayRows.map((row) => ({
      ...row,
      changed_attendees: Number(row.changed_attendees ?? 0),
      day_changes: Number(row.day_changes ?? 0),
      left_in_person_attendees: Number(row.left_in_person_attendees ?? 0),
      joined_in_person_attendees: Number(row.joined_in_person_attendees ?? 0),
    })),
    recent: [...recentByChange.values()],
  };
}
