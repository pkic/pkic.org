import type { EventRegistrationAttendanceChange } from "../../../../assets/shared/schemas/event-registrations";
import { all } from "../../db/queries";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import type { DatabaseLike } from "../../types";

interface AttendanceChangeRow {
  registration_id: string;
  changed_at: string;
  from_type: string;
  to_type: string;
  day_date: string;
  day_label: string | null;
}

/** Exact event-owned registrations from a bounded page or one authorized detail read. */
export async function loadRegistrationAttendanceChanges(
  db: DatabaseLike,
  eventId: string,
  registrationIds: readonly string[],
): Promise<Map<string, EventRegistrationAttendanceChange[]>> {
  const histories = new Map<string, EventRegistrationAttendanceChange[]>();
  if (registrationIds.length === 0) return histories;
  const filter = buildD1JsonMembershipFilter("h.registration_id", registrationIds);
  const rows = await all<AttendanceChangeRow>(
    db,
    `SELECT h.registration_id,h.changed_at,
      COALESCE(h.from_type,'not_attending') AS from_type,
      COALESCE(h.to_type,'not_attending') AS to_type,
      ed.day_date,COALESCE(ed.label,ed.day_date) AS day_label
    FROM registration_attendance_history h
    JOIN registrations r ON r.id=h.registration_id
    JOIN event_days ed ON ed.id=h.event_day_id AND ed.event_id=r.event_id
    WHERE r.event_id=? AND ${filter.sql} AND h.changed_by<>'system'
      AND COALESCE(h.from_type,'')<>COALESCE(h.to_type,'')
    ORDER BY h.registration_id ASC,h.changed_at ASC,ed.sort_order ASC,ed.day_date ASC`,
    [eventId, ...filter.bindings],
  );
  for (const row of rows) {
    let history = histories.get(row.registration_id);
    if (!history) {
      history = [];
      histories.set(row.registration_id, history);
    }
    let change = history.at(-1);
    if (!change || change.changedAt !== row.changed_at) {
      change = { changedAt: row.changed_at, transitions: [] };
      history.push(change);
    }
    let transition = change.transitions.find((item) => item.fromType === row.from_type && item.toType === row.to_type);
    if (!transition) {
      transition = { fromType: row.from_type, toType: row.to_type, days: [] };
      change.transitions.push(transition);
    }
    transition.days.push({ dayDate: row.day_date, label: row.day_label });
  }
  return histories;
}
