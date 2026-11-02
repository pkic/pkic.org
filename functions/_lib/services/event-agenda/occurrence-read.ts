import { batchRows } from "../../db/pagination";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { readAgendaSpeakers } from "./speaker-profiles";
import { readAgendaSponsorRows, agendaSponsorDisplay, type AgendaSponsorRow } from "./sponsors";
import { agendaSponsorIdsSchema } from "../../../../assets/shared/schemas/event-agenda-sponsors";
import { agendaPublicationStatusSql } from "./publication-status";
import { promotionCopySchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
import { agendaOccurrenceSchema, type AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { agendaOccurrenceSelection, type AgendaOccurrenceSelection } from "./occurrence-selection";
export interface OccurrenceRow {
  source_proposal_type: string | null;
  content_id: string | null;
  publication_status: string;
  id: string;
  title: string;
  description: string;
  presentation_url: string | null;
  recording_url: string | null;
  virtual_room_url: string | null;
  virtual_room_type: string | null;
  sponsor_ids_json: string | null;
  public_anchor: string | null;
  start_at: string | null;
  end_at: string | null;
  room_id: string | null;
  required_equipment_json: string;
  planned_media_json: string | null;
  admission_policy: string;
  access_policy: string;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  capacity: number | null;
  remote_capacity: number | null;
  visibility: string;
  kind: string;
  track: string | null;
  format: string | null;
  placeholder: number;
  pending_speaker_count: number;
}
/**
 * Speakers of the session's proposal who have not accepted yet. They stay off the agenda until they do, so the
 * organizer sees the count rather than the people.
 */
const pendingSpeakerCountSql = `(SELECT COUNT(*) FROM event_agenda_contents content
  JOIN session_proposals proposal ON proposal.id=content.proposal_id AND proposal.event_id=content.event_id
  JOIN proposal_speakers pending ON pending.proposal_id=proposal.id
  WHERE content.id=event_agenda_occurrences.content_id AND pending.status='invited'
    AND proposal.deleted_at IS NULL AND proposal.status='accepted')`;
const columns =
  "id,content_id,title,description,presentation_url,recording_url,public_anchor,start_at,end_at,room_id,admission_policy,access_policy,booking_opens_at,booking_closes_at,capacity,remote_capacity,visibility,kind,track,format,placeholder,required_equipment_json,planned_media_json";
export function prepareAgendaOccurrenceRows(
  db: DatabaseLike,
  eventId: EventReadSelection,
  where = "",
  values: unknown[] = [],
  suffix = "ORDER BY start_at,id LIMIT 2001",
) {
  const scope = eventReadIdSql(eventId);
  return db
    .prepare(
      `SELECT ${columns},json_extract((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionMedia.'||json_quote(id)||'.joinUrl') AS virtual_room_url,json_type((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionMedia.'||json_quote(id)||'.joinUrl') AS virtual_room_type,json_extract((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionSponsors.'||json_quote(id)||'.sponsorIds') AS sponsor_ids_json,${agendaPublicationStatusSql} AS publication_status,(SELECT proposal.proposal_type FROM session_proposals proposal WHERE proposal.id = substr(event_agenda_occurrences.source_key, 10) AND proposal.event_id = event_agenda_occurrences.event_id AND event_agenda_occurrences.source_key = 'proposal:' || proposal.id) AS source_proposal_type,${pendingSpeakerCountSql} AS pending_speaker_count FROM event_agenda_occurrences WHERE event_id = ${scope.sql} ${where} ${suffix}`,
    )
    .bind(...scope.bindings, ...values);
}

/** Histories, promotion copy, and room links use the same bounded event selection in both read paths. */
export function prepareAgendaOccurrenceDetails(
  db: DatabaseLike,
  eventId: EventReadSelection,
  ids?: string[] | AgendaOccurrenceSelection,
) {
  const selection = agendaOccurrenceSelection(eventId, ids);
  return [
    db
      .prepare(
        `SELECT occurrence_id,metadata_json FROM event_agenda_session_history WHERE occurrence_id IN(${selection.sql}) LIMIT 2001`,
      )
      .bind(...selection.bindings),
    db
      .prepare(
        `SELECT id AS occurrence_id,promotion_copy_json AS copy_json FROM event_agenda_occurrences WHERE promotion_copy_json IS NOT NULL AND id IN(${selection.sql}) LIMIT 2001`,
      )
      .bind(...selection.bindings),
    db
      .prepare(
        `SELECT occurrence_id,room_id FROM event_agenda_occurrence_rooms WHERE occurrence_id IN(${selection.sql}) ORDER BY occurrence_id,room_id LIMIT 38001`,
      )
      .bind(...selection.bindings),
  ];
}

export async function readAgendaOccurrences(
  db: DatabaseLike,
  eventId: string,
  where = "",
  values: unknown[] = [],
  suffix = "ORDER BY start_at,id LIMIT 2001",
) {
  const rows = (await prepareAgendaOccurrenceRows(db, eventId, where, values, suffix).all<OccurrenceRow>()).results;
  const sponsorIdsByOccurrence = new Map(
    rows
      .filter((row) => row.kind === "break" && row.sponsor_ids_json !== null)
      .map((row) => [row.id, agendaSponsorIdsSchema.parse(JSON.parse(row.sponsor_ids_json!))]),
  );
  const [speakerGroups, details, sponsorRows] = await Promise.all([
    readAgendaSpeakers(
      db,
      eventId,
      rows.map((row) => row.id),
    ),
    db.batch(
      prepareAgendaOccurrenceDetails(
        db,
        eventId,
        rows.map((row) => row.id),
      ),
    ),
    readAgendaSponsorRows(db, eventId, [...new Set([...sponsorIdsByOccurrence.values()].flat())]),
  ]);
  return decodeAgendaOccurrences(rows, speakerGroups, details, sponsorRows);
}

export function decodeAgendaOccurrences(
  rows: OccurrenceRow[],
  speakerGroups: Map<string, AgendaOccurrence["speakers"]>,
  details: D1StatementResult[],
  sponsorRows: AgendaSponsorRow[],
) {
  const sponsorIdsByOccurrence = new Map(
    rows
      .filter((row) => row.kind === "break" && row.sponsor_ids_json !== null)
      .map((row) => [row.id, agendaSponsorIdsSchema.parse(JSON.parse(row.sponsor_ids_json!))]),
  );
  const histories = batchRows<{ occurrence_id: string; metadata_json: string }>(details[0]);
  const copies = batchRows<{ occurrence_id: string; copy_json: string }>(details[1]);
  const additionalRooms = batchRows<{ occurrence_id: string; room_id: string }>(details[2]);
  const historyById = new Map(
    histories.map((row) => [row.occurrence_id, sessionHistoryMetadataSchema.parse(JSON.parse(row.metadata_json))]),
  );
  const copyById = new Map(
    copies.map((row) => [row.occurrence_id, promotionCopySchema.parse(JSON.parse(row.copy_json))]),
  );
  const roomsByOccurrence = new Map<string, string[]>();
  for (const room of additionalRooms)
    roomsByOccurrence.set(room.occurrence_id, [...(roomsByOccurrence.get(room.occurrence_id) ?? []), room.room_id]);
  const sponsorsById = new Map(sponsorRows.map((sponsor) => [sponsor.sponsor_id, agendaSponsorDisplay(sponsor)]));
  return rows.map((row) =>
    agendaOccurrenceSchema.parse({
      id: row.id,
      contentId: row.content_id,
      publicationStatus: row.publication_status,
      sourceProposalType: row.source_proposal_type,
      ...(sponsorIdsByOccurrence.has(row.id)
        ? {
            sponsorIds: sponsorIdsByOccurrence.get(row.id),
            sponsors: (sponsorIdsByOccurrence.get(row.id) ?? []).flatMap((id) =>
              sponsorsById.has(id) ? [sponsorsById.get(id)!] : [],
            ),
          }
        : {}),
      history: historyById.get(row.id),
      promotionCopy: copyById.get(row.id),
      title: row.title,
      description: row.description,
      presentationUrl: row.presentation_url,
      recordingUrl: row.recording_url,
      ...(row.virtual_room_type !== null ? { virtualRoomUrl: row.virtual_room_url } : {}),
      publicAnchor: row.public_anchor,
      startAt: row.start_at,
      endAt: row.end_at,
      roomId: row.room_id,
      additionalRoomIds: roomsByOccurrence.get(row.id) ?? [],
      requiredEquipment: JSON.parse(row.required_equipment_json),
      ...(row.planned_media_json !== null ? { plannedMedia: JSON.parse(row.planned_media_json) } : {}),
      admissionPolicy: row.admission_policy,
      accessPolicy: row.access_policy,
      bookingOpensAt: row.booking_opens_at,
      bookingClosesAt: row.booking_closes_at,
      capacity: row.capacity,
      remoteCapacity: row.remote_capacity,
      visibility: row.visibility,
      kind: row.kind,
      track: row.track,
      format: row.format,
      placeholder: row.placeholder === 1,
      pendingSpeakerCount: row.pending_speaker_count,
      speakers: speakerGroups.get(row.id) ?? [],
    }),
  );
}
