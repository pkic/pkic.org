-- Registration-wide attendance was retired in 0039. Delivery must use the
-- confirmed day selection and its configured live access mode.
DROP VIEW email_delivery_guard_states;
CREATE VIEW email_delivery_guard_states AS
 SELECT reminder.id,reminder.sequence AS version,
 CASE WHEN reminder.status='queued' AND reminder.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND reminder.start_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND person.active=1 AND person.email=reminder.recipient_email AND preference.reminder_enabled=1 AND preference.reminder_minutes=reminder.reminder_minutes
 AND participation.status='reserved' AND entry.sequence=reminder.sequence AND entry.status='confirmed'
 AND json_extract(occurrence.value,'$.startAt')=reminder.start_at
 AND registration.status='registered'
 AND EXISTS (
   SELECT 1 FROM registration_day_attendance attendance
   JOIN event_days day ON day.id=attendance.event_day_id
   WHERE attendance.registration_id=registration.id AND day.event_id=registration.event_id
     AND day.day_date=reminder.day_date
     AND COALESCE((
       SELECT CASE WHEN json_valid(option.value) THEN json_extract(option.value,'$.accessMode') END
       FROM json_each(CASE WHEN json_valid(day.attendance_options_json) THEN day.attendance_options_json ELSE '[]' END) option
       WHERE CASE WHEN json_valid(option.value) THEN json_extract(option.value,'$.value') END=attendance.attendance_type
       LIMIT 1
     ), CASE attendance.attendance_type WHEN 'in_person' THEN 'physical' WHEN 'virtual' THEN 'remote' ELSE 'none' END)=participation.attendance_mode
     AND NOT EXISTS (
       SELECT 1 FROM event_day_waitlist_entries waiting
       WHERE waiting.registration_id=attendance.registration_id AND waiting.event_day_id=attendance.event_day_id
         AND waiting.status IN ('waiting','offered','expired')
     )
 )
 THEN 1 ELSE 0 END AS deliverable
 FROM agenda_session_reminders reminder
 JOIN users person ON person.id=reminder.user_id
 JOIN agenda_calendar_preferences preference ON preference.event_id=reminder.event_id AND preference.user_id=reminder.user_id
 LEFT JOIN agenda_session_participations participation ON participation.occurrence_id=reminder.occurrence_id AND participation.user_id=reminder.user_id
 LEFT JOIN agenda_calendar_entries entry ON entry.event_id=reminder.event_id AND entry.occurrence_id=reminder.occurrence_id AND entry.user_id=reminder.user_id
 LEFT JOIN registrations registration ON registration.event_id=reminder.event_id AND registration.user_id=reminder.user_id
 LEFT JOIN event_agenda_state state ON state.event_id=reminder.event_id
 LEFT JOIN event_agenda_publications publication ON publication.event_id=state.event_id AND publication.revision=state.published_revision
 LEFT JOIN json_each(publication.snapshot_json,'$.occurrences') occurrence ON json_extract(occurrence.value,'$.id')=reminder.occurrence_id
 UNION ALL SELECT invitation.id,0 AS version,CASE WHEN invitation.revoked_at IS NULL AND person.active=1 THEN 1 ELSE 0 END AS deliverable
 FROM agenda_session_invitations invitation JOIN users person ON person.id=invitation.user_id;
