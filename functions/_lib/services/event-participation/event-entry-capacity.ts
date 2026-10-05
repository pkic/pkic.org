import { liveOperationalDaysSql } from "../event-agenda/operational-days";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "../registrations/day-waitlist-policy";
/** Registration, valid offers and operational roles consume one event-day place per person. */
export function eventEntryOccupiedSql(
  event: string,
  day: string,
  excludeUser?: string,
  includeOffers = true,
  now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  operational = liveOperationalDaysSql,
) {
  // Registration branches are mutually exclusive; outer UNION deduplicates people.
  const exclude = excludeUser ? ` AND r.user_id<>${excludeUser}` : "";
  return `(SELECT COUNT(*) FROM (
 SELECT person.user_id FROM (${operational}) person WHERE person.event_id=${event} AND person.day_date=${day}${excludeUser ? ` AND person.user_id<>${excludeUser}` : ""}
 UNION SELECT registered.user_id FROM (
 SELECT r.user_id FROM event_days selected_day
 JOIN registration_day_attendance attendance ON attendance.event_day_id=selected_day.id AND attendance.attendance_type='in_person'
 JOIN registrations r ON r.id=attendance.registration_id
 LEFT JOIN event_day_waitlist_entries w ON w.event_day_id=selected_day.id AND w.registration_id=r.id AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
 WHERE selected_day.event_id=${event} AND selected_day.day_date=${day} AND r.event_id=${event} AND r.status IN ('pending_email_confirmation','registered')${exclude} AND w.id IS NULL
 UNION ALL SELECT r.user_id FROM (SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM event_days configured_day WHERE configured_day.event_id=${event} AND configured_day.day_date=${day})) unconfigured_day CROSS JOIN registrations r
 WHERE r.event_id=${event} AND r.status IN ('pending_email_confirmation','registered')${exclude} AND r.attendance_type='in_person'
 ) registered
 ${includeOffers ? `UNION SELECT r.user_id FROM event_day_waitlist_entries w JOIN registrations r ON r.id=w.registration_id JOIN event_days d ON d.id=w.event_day_id WHERE d.event_id=${event} AND d.day_date=${day} AND w.status='offered' AND (w.offer_expires_at IS NULL OR w.offer_expires_at>${now}) AND r.status IN ('pending_email_confirmation','registered')${exclude}` : ""}
 ))`;
}
