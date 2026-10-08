import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { agendaSpeakerSchema, type AgendaOccurrence } from "../../../../assets/shared/schemas/event-agenda";
import { proposalSpeakerEffectiveProfileExpression } from "../proposal-speaker-profile-projection";
import { publicUserHeadshotPath } from "../user-headshot";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";

/** Available person data stays in the authorized editing read model; representation requires explicit review. */
export async function readAgendaSpeakers(db: DatabaseLike, eventId: string, occurrenceIds: string[]) {
  const rows = occurrenceIds.length
    ? await all<{
        occurrence_id: string;
        user_id: string;
        display_name: string;
        role: string;
        attendance_mode: "physical" | "remote";
        room_id: string | null;
        biography: string | null;
        headshot_r2_key: string | null;
      }>(
        db,
        `SELECT speaker.occurrence_id,speaker.user_id,speaker.role,speaker.attendance_mode,speaker.room_id,
          ${agendaSpeakerDisplayNameSql} AS display_name,
          CASE WHEN user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
            THEN CASE WHEN ps.id IS NOT NULL THEN ${proposalSpeakerEffectiveProfileExpression("user", "ps", "biography", "biography")} ELSE user.biography END END AS biography,
          CASE WHEN user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
            AND COALESCE(ps.headshot_override_set,0)=0 THEN user.headshot_r2_key END AS headshot_r2_key
        FROM event_agenda_occurrence_speakers speaker
        JOIN users user ON user.id=speaker.user_id
        JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id
        LEFT JOIN session_proposals proposal ON proposal.event_id=occurrence.event_id
          AND occurrence.source_key='proposal:'||proposal.id AND proposal.deleted_at IS NULL AND proposal.status='accepted'
        LEFT JOIN proposal_speakers ps ON ps.proposal_id=proposal.id AND ps.user_id=speaker.user_id AND ps.status<>'declined'
        WHERE speaker.occurrence_id IN(SELECT value FROM json_each(?)) AND occurrence.event_id=? LIMIT 60000`,
        [JSON.stringify(occurrenceIds), eventId],
      )
    : [];
  const groups = new Map<string, AgendaOccurrence["speakers"]>();
  for (const row of rows) {
    const group = groups.get(row.occurrence_id) ?? [];
    group.push(
      agendaSpeakerSchema.parse({
        userId: row.user_id,
        displayName: row.display_name,
        role: row.role,
        attendanceMode: row.attendance_mode,
        roomId: row.room_id,
        profileCandidate: {
          biography: row.biography,
          photoUrl: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
        },
      }),
    );
    groups.set(row.occurrence_id, group);
  }
  return groups;
}
