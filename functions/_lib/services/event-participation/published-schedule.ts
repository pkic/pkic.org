/** Operational attendee reads come from the approved revision, independently of organizer drafts. */
export const publishedSessionsSql = `SELECT published.event_id,published.revision AS published_revision,
 json_extract(published.snapshot_json,'$.timeZone') AS timezone,
 json_extract(source.value,'$.id') AS id,
 json_extract(source.value,'$.title') AS title,
 json_extract(source.value,'$.startAt') AS start_at,
 json_extract(source.value,'$.endAt') AS end_at,
 json_extract(source.value,'$.roomId') AS room_id,
 COALESCE(json_extract(source.value,'$.additionalRoomIds'),'[]') AS additional_room_ids_json,
 json_extract(source.value,'$.admissionPolicy') AS admission_policy,
 COALESCE(json_extract(source.value,'$.accessPolicy'),'open') AS access_policy,
 json_extract(source.value,'$.bookingOpensAt') AS booking_opens_at,
 json_extract(source.value,'$.bookingClosesAt') AS booking_closes_at,
 json_extract(source.value,'$.capacity') AS capacity,
 json_extract(source.value,'$.remoteCapacity') AS remote_capacity,
 json_extract(source.value,'$.visibility') AS visibility,
 json_extract(source.value,'$.plannedMedia.liveStreaming') AS planned_live_streaming
 FROM event_agenda_publications published
 JOIN event_agenda_state state ON state.event_id=published.event_id AND state.published_revision=published.revision
 JOIN json_each(published.snapshot_json,'$.occurrences') source`;
/** `position` is the location's place in the published agenda's location order. */
export const publishedRoomsSql = `SELECT published.event_id,source.key AS position,json_extract(source.value,'$.id') AS id,json_extract(source.value,'$.name') AS name,json_extract(source.value,'$.capacity') AS capacity
 FROM event_agenda_publications published JOIN event_agenda_state state ON state.event_id=published.event_id AND state.published_revision=published.revision
 JOIN json_each(published.snapshot_json,'$.rooms') source`;
