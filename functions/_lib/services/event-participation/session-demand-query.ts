import { onPersonalAgendaSql } from "./personal-agenda-membership";
/** Trusted selection SQL only. Favorites remain independent of capacity-backed participation. */
export function sessionDemandAggregateSql(selectedOccurrencesSql: string) {
  return `SELECT participation.occurrence_id,participation.attendance_mode,
    COUNT(DISTINCT CASE WHEN participation.status='reserved' THEN participation.user_id END) AS confirmed,
    COUNT(DISTINCT CASE WHEN participation.status='approval_pending' THEN participation.user_id END) AS pending,
    COUNT(DISTINCT CASE WHEN participation.status='waitlisted' THEN participation.user_id END) AS waitlisted,
    COUNT(DISTINCT CASE WHEN participation.saved=1 THEN participation.user_id END) AS preferences
  FROM agenda_session_participations participation
  JOIN (${selectedOccurrencesSql}) selected ON selected.id=participation.occurrence_id AND selected.event_id=participation.event_id
  WHERE ${onPersonalAgendaSql("participation")}
  GROUP BY participation.occurrence_id,participation.attendance_mode`;
}
