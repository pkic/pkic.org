import { publishedSessionsSql } from "./published-schedule";
/** Rechecked at claim and immediately before transport; browser permission is not stored authorization. */
export function webPushDeliverableSql(alias = "outbox") {
  return `EXISTS(SELECT 1 FROM agenda_push_devices device
  JOIN agenda_push_event_preferences preference ON preference.device_id=device.id AND preference.event_id=${alias}.event_id
  JOIN users user ON user.id=device.user_id
  WHERE device.id=${alias}.device_id AND device.user_id=${alias}.user_id AND user.active=1
    AND device.revoked_at IS NULL AND (device.expires_at IS NULL OR device.expires_at>?) AND preference.enabled=1
    AND (${alias}.kind='agenda_changed' AND EXISTS(SELECT 1 FROM event_agenda_state state WHERE state.event_id=${alias}.event_id AND state.published_revision=${alias}.source_version)
      AND EXISTS(SELECT 1 FROM agenda_session_participations p WHERE p.event_id=${alias}.event_id AND p.user_id=${alias}.user_id AND p.status IN('saved','reserved','approval_pending'))
      OR ${alias}.kind='session_reminder' AND preference.reminder_minutes=${alias}.reminder_minutes AND EXISTS(
        SELECT 1 FROM agenda_calendar_entries entry WHERE entry.event_id=${alias}.event_id AND entry.user_id=${alias}.user_id
          AND entry.occurrence_id=${alias}.occurrence_id AND entry.sequence=${alias}.source_version AND entry.status='confirmed' AND entry.start_at>?
          AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) published WHERE published.event_id=entry.event_id AND published.id=entry.occurrence_id AND published.start_at=entry.start_at)
          AND EXISTS(SELECT 1 FROM agenda_session_participations participation JOIN registrations registration ON registration.event_id=participation.event_id AND registration.user_id=participation.user_id
            WHERE participation.event_id=entry.event_id AND participation.occurrence_id=entry.occurrence_id AND participation.user_id=entry.user_id AND participation.status='reserved' AND registration.status='registered'
              AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=registration.id AND day.day_date=${alias}.day_date),
                CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=entry.event_id AND day.day_date=${alias}.day_date) THEN 'none' ELSE registration.attendance_type END)=CASE participation.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END))))`;
}
