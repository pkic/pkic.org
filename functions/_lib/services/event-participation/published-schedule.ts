/** Operational attendee reads come from the approved revision, independently of organizer drafts. */
export const publishedSessionsSql = `SELECT published.event_id,
 json_extract(published.snapshot_json,'$.timeZone') AS timezone,
 json_extract(source.value,'$.id') AS id,
 json_extract(source.value,'$.title') AS title,
 json_extract(source.value,'$.startAt') AS start_at,
 json_extract(source.value,'$.endAt') AS end_at,
 json_extract(source.value,'$.roomId') AS room_id,
 json_extract(source.value,'$.admissionPolicy') AS admission_policy,
 json_extract(source.value,'$.capacity') AS capacity,
 json_extract(source.value,'$.remoteCapacity') AS remote_capacity,
 json_extract(source.value,'$.visibility') AS visibility
 FROM event_agenda_publications published
 JOIN event_agenda_state state ON state.event_id=published.event_id AND state.published_revision=published.revision
 JOIN json_each(published.snapshot_json,'$.occurrences') source`;
export const publishedRoomsSql = `SELECT published.event_id,json_extract(source.value,'$.id') AS id,json_extract(source.value,'$.capacity') AS capacity
 FROM event_agenda_publications published JOIN event_agenda_state state ON state.event_id=published.event_id AND state.published_revision=published.revision
 JOIN json_each(published.snapshot_json,'$.rooms') source`;
