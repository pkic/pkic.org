import { agendaRoomOrderPositionSql } from "./room-order-settings";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";
/** Indexed immutable occurrence projection keeps draft status queries bounded. */
const draft = "event_agenda_occurrences";
const fields = {
  title: "title",
  description: "description",
  startAt: "start_at",
  endAt: "end_at",
  roomId: "room_id",
  admissionPolicy: "admission_policy",
  capacity: "capacity",
  remoteCapacity: "remote_capacity",
  visibility: "visibility",
  kind: "kind",
  track: "track",
  presentationUrl: "presentation_url",
  recordingUrl: "recording_url",
  bookingOpensAt: "booking_opens_at",
  bookingClosesAt: "booking_closes_at",
};
const matches = Object.entries(fields)
  .map(([field, column]) => `json_extract(approved.payload_json,'$.${field}') IS ${draft}.${column}`)
  .join(" AND ");
const virtualRoomMatches = `json_extract(approved.payload_json,'$.virtualRoomUrl') IS (SELECT json_extract(event.settings_json,'$.agenda.sessionMedia.'||json_quote(${draft}.id)||'.joinUrl') FROM events event WHERE event.id=${draft}.event_id)`;
const sponsorIdsMatch = `COALESCE(json_extract(approved.payload_json,'$.sponsorIds'),'[]') IS COALESCE((SELECT json_extract(event.settings_json,'$.agenda.sessionSponsors.'||json_quote(${draft}.id)||'.sponsorIds') FROM events event WHERE event.id=${draft}.event_id),'[]')`;
const speakerMatches = `NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker WHERE speaker.occurrence_id=${draft}.id AND NOT EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.speakers') person WHERE json_extract(person.value,'$.userId')=speaker.user_id)) AND NOT EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.speakers') person WHERE NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker WHERE speaker.occurrence_id=${draft}.id AND speaker.user_id=json_extract(person.value,'$.userId') AND speaker.role=COALESCE(json_extract(person.value,'$.role'),'speaker') AND speaker.attendance_mode=COALESCE(json_extract(person.value,'$.attendanceMode'),'physical') AND COALESCE(speaker.room_id,${draft}.room_id) IS COALESCE(json_extract(person.value,'$.roomId'),${draft}.room_id)))`;
const speakerNamesMatch = `NOT EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.speakers') person JOIN users user ON user.id=json_extract(person.value,'$.userId') WHERE json_extract(person.value,'$.displayName') IS NOT ${agendaSpeakerDisplayNameSql})`;
const currentProjection = `SELECT approved.payload_json FROM event_agenda_state state JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision WHERE state.event_id=${draft}.event_id AND approved.occurrence_id=${draft}.id`;
const roomMatches = `(${draft}.room_id IS NULL OR EXISTS(SELECT 1 FROM event_agenda_rooms room WHERE room.id=${draft}.room_id AND room.event_id=${draft}.event_id AND json_extract(approved.room_json,'$.name') IS room.name AND json_extract(approved.room_json,'$.capacity') IS room.capacity AND COALESCE(json_extract(approved.room_json,'$.setupMinutes'),0)=room.setup_minutes AND COALESCE(json_extract(approved.room_json,'$.equipment'),'[]')=room.equipment_json AND COALESCE(json_extract(approved.room_json,'$.availablePeriods'),'[]')=room.available_periods_json))`;

const roomOrderMatches = `(SELECT json_group_array(id) FROM (SELECT room.id FROM event_agenda_rooms room JOIN events event ON event.id=room.event_id WHERE room.event_id=${draft}.event_id ORDER BY ${agendaRoomOrderPositionSql("room.id", "event.settings_json")},room.name,room.id)) IS (SELECT json_group_array(id) FROM (SELECT json_extract(value,'$.id') AS id FROM event_agenda_publications publication,json_each(publication.snapshot_json,'$.rooms') WHERE publication.event_id=approved.event_id AND publication.revision=approved.revision ORDER BY CAST(key AS INTEGER)))`;
const additionalRoomsMatch = `NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_rooms extra WHERE extra.occurrence_id=${draft}.id AND NOT EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.additionalRoomIds') approved_room WHERE approved_room.value=extra.room_id)) AND NOT EXISTS(SELECT 1 FROM json_each(approved.payload_json,'$.additionalRoomIds') approved_room WHERE NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_rooms extra WHERE extra.occurrence_id=${draft}.id AND extra.room_id=approved_room.value)) AND NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_rooms extra JOIN event_agenda_rooms room ON room.id=extra.room_id WHERE extra.occurrence_id=${draft}.id AND NOT EXISTS(SELECT 1 FROM event_agenda_publications publication JOIN json_each(publication.snapshot_json,'$.rooms') approved_room WHERE publication.event_id=approved.event_id AND publication.revision=approved.revision AND json_extract(approved_room.value,'$.id')=room.id AND json_extract(approved_room.value,'$.name') IS room.name AND json_extract(approved_room.value,'$.capacity') IS room.capacity AND COALESCE(json_extract(approved_room.value,'$.setupMinutes'),0)=room.setup_minutes AND COALESCE(json_extract(approved_room.value,'$.equipment'),'[]')=room.equipment_json AND COALESCE(json_extract(approved_room.value,'$.availablePeriods'),'[]')=room.available_periods_json))`;

export const agendaPublicationStatusSql = `CASE WHEN NOT EXISTS(${currentProjection}) THEN 'unpublished' WHEN EXISTS(${currentProjection} AND ${matches} AND ${virtualRoomMatches} AND ${sponsorIdsMatch} AND COALESCE(json_extract(approved.payload_json,'$.accessPolicy'),'open')=${draft}.access_policy AND COALESCE(json_extract(approved.payload_json,'$.requiredEquipment'),'[]')=${draft}.required_equipment_json AND ${speakerMatches} AND ${speakerNamesMatch} AND ${roomMatches} AND ${roomOrderMatches} AND ${additionalRoomsMatch} AND json_extract(approved.payload_json,'$.history') IS (SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=${draft}.id) AND json_extract(approved.payload_json,'$.promotionCopy') IS (SELECT copy_json FROM event_agenda_promotion_copy WHERE occurrence_id=${draft}.id)) THEN 'published' ELSE 'changed' END`;
