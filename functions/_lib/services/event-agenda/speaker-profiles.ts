import type { DatabaseLike } from "../../types";
import { agendaSpeakerSchema, type AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { identityJobTitleSql } from "../identities/affiliation-projection";
import { creditedIdentityIdSql } from "./credited-identity";
import { publicUserHeadshotPath } from "../user-headshot";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { agendaOccurrenceSelection, type AgendaOccurrenceSelection } from "./occurrence-selection";

export interface AgendaSpeakerRow {
  occurrence_id: string;
  user_id: string;
  identity_order: number;
  display_name: string;
  role: string;
  attendance_mode: "physical" | "remote";
  room_id: string | null;
  identity_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
}

/**
 * Each credited person as the identity they speak as says now (the one rule in
 * `credited-identity.ts`), with the person's own photo. Available person data stays in the
 * authorized editing read model; representation requires explicit review.
 */
export function prepareAgendaSpeakers(
  db: DatabaseLike,
  eventId: EventReadSelection,
  occurrenceIds?: string[] | AgendaOccurrenceSelection,
  profile: "full" | "credit" = "full",
) {
  const scope = eventReadIdSql(eventId);
  const selection = agendaOccurrenceSelection(eventId, occurrenceIds);
  return db
    .prepare(`WITH agenda_speaker_page AS MATERIALIZED(${selection.sql})
        SELECT credited.occurrence_id,credited.user_id,CAST(selected.key AS INTEGER) AS identity_order,credited.role,credited.attendance_mode,credited.room_id,
          credited.display_name,
          CASE WHEN credited.available=1 THEN spoken_as.id END AS identity_id,
          CASE WHEN credited.available=1 THEN spoken_as.organization_id END AS organization_id,
          CASE WHEN credited.available=1 THEN spoken_as_organization.name END AS organization_name,
          CASE WHEN credited.available=1 THEN ${identityJobTitleSql("spoken_as.id")} END AS job_title,
          ${profile === "full" ? "CASE WHEN credited.available=1 THEN spoken_as.biography END" : "NULL"} AS biography,
          ${profile === "full" ? "CASE WHEN credited.available=1 THEN spoken_as.links_json END" : "NULL"} AS links_json,
          CASE WHEN credited.available=1 THEN credited.headshot_r2_key END AS headshot_r2_key
        FROM (
          SELECT speaker.occurrence_id,speaker.user_id,speaker.role,speaker.attendance_mode,speaker.room_id,
            ${agendaSpeakerDisplayNameSql} AS display_name, user.headshot_r2_key,
            COALESCE((SELECT CAST(ordered.key AS INTEGER) FROM json_each(COALESCE(
              json_extract((SELECT settings_json FROM events WHERE id=occurrence.event_id),'$.agenda.sessionSpeakerOrder.'||json_quote(occurrence.id)),
              content.speaker_user_ids_json,'[]')) ordered WHERE ordered.value=speaker.user_id),60000) AS speaker_order,
            (user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL) AS available,
            COALESCE(json_extract((SELECT settings_json FROM events WHERE id=occurrence.event_id),
              '$.agenda.sessionSpeakerIdentities.'||json_quote(occurrence.id)||'.'||json_quote(speaker.user_id)),
              json_array(${creditedIdentityIdSql("speaker.occurrence_id", "speaker.user_id")})) AS identity_ids_json
          FROM event_agenda_occurrence_speakers speaker
          JOIN users user ON user.id=speaker.user_id
          JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id
          LEFT JOIN event_agenda_contents content ON content.id=occurrence.content_id AND content.event_id=occurrence.event_id
          WHERE occurrence.event_id=${scope.sql}
            AND speaker.occurrence_id IN(SELECT id FROM agenda_speaker_page)
            LIMIT 60000
        ) credited
        JOIN json_each(credited.identity_ids_json) selected
        LEFT JOIN identities spoken_as ON spoken_as.id=selected.value AND spoken_as.user_id=credited.user_id
        LEFT JOIN organizations spoken_as_organization ON spoken_as_organization.id=spoken_as.organization_id
        ORDER BY credited.occurrence_id,credited.speaker_order,credited.user_id,CAST(selected.key AS INTEGER)`)
    .bind(...selection.bindings, ...scope.bindings);
}

export function decodeAgendaSpeakers(rows: AgendaSpeakerRow[]) {
  const groups = new Map<string, AgendaOccurrence["speakers"]>();
  for (const row of rows) {
    const group = groups.get(row.occurrence_id) ?? [];
    const candidate = {
      identityId: row.identity_id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      jobTitle: row.job_title,
      biography: row.biography,
      links: parseLinksJson(row.links_json),
      photoUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
    };
    const existing = group.find((speaker) => speaker.userId === row.user_id);
    if (existing) existing.profileCandidates!.push(candidate);
    else
      group.push(
        agendaSpeakerSchema.parse({
          userId: row.user_id,
          displayName: row.display_name,
          role: row.role,
          attendanceMode: row.attendance_mode,
          roomId: row.room_id,
          profileCandidate: candidate,
          profileCandidates: [candidate],
        }),
      );
    groups.set(row.occurrence_id, group);
  }
  return groups;
}

export async function readAgendaSpeakers(db: DatabaseLike, eventId: string, occurrenceIds: string[]) {
  if (!occurrenceIds.length) return new Map<string, AgendaOccurrence["speakers"]>();
  const result = await prepareAgendaSpeakers(db, eventId, occurrenceIds).all<AgendaSpeakerRow>();
  return decodeAgendaSpeakers(result.results);
}
