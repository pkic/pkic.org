/**
 * SQL for a session's effective virtual-room link, mirroring `agendaOccurrenceMedia`: a session's own link
 * wins; otherwise a session without its own media plan follows its primary location's link.
 */

/** The link an approved occurrence row captured, from its payload and the location captured beside it. */
export function approvedVirtualRoomUrlSql(approved: string) {
  return `COALESCE(json_extract(${approved}.payload_json,'$.virtualRoomUrl'),CASE WHEN json_extract(${approved}.payload_json,'$.plannedMedia') IS NULL THEN json_extract(${approved}.room_json,'$.virtualRoomUrl') END)`;
}

/** The link the current draft would publish; an approved link is released only while the two still agree. */
export function draftVirtualRoomUrlSql(occurrenceId: string, settingsJson: string) {
  return `COALESCE(json_extract(${settingsJson},'$.agenda.sessionMedia.'||json_quote(${occurrenceId})||'.joinUrl'),(SELECT location.virtual_room_url FROM event_agenda_occurrences draft_media JOIN event_agenda_rooms location ON location.id=draft_media.room_id AND location.event_id=draft_media.event_id WHERE draft_media.id=${occurrenceId} AND draft_media.planned_media_json IS NULL))`;
}
