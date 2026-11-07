import { prepareEventSpeakingStanding } from "../member-standing/event-speaking";
import { agendaCreditRoleSchema } from "../../../../assets/shared/schemas/agenda-credit-role";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareScopedAuditLog } from "../audit";
import { proposalOccurrenceSql } from "./declined-speaker-removal";
import { prepareAgendaScheduleGuard } from "./schedule-guards";
import { prepareAgendaRevisionGuard } from "./revision";

/**
 * Credits a speaker who confirms after their proposal was placed on every
 * session placed from it, inside the caller's confirmation batch. It mirrors a
 * decline: the agenda revision advances, so the change shows as unpublished
 * and the agenda goes out again only after the planner approves it.
 *
 * The revision is read before anything is derived from the agenda and is
 * guarded in the batch even when nothing is placed yet, so a placement that
 * lands in between refuses the confirmation instead of copying the roster
 * without this speaker.
 */
export async function prepareConfirmedSpeakerAgendaAddition(
  db: DatabaseLike,
  input: {
    eventId: string;
    proposalId: string;
    speaker: { userId: string; proposalRole: string };
    /** Who confirmed: the speaker, or an organizer accepting for them. */
    actor: { type: "user" | "admin"; id: string };
    at: string;
  },
): Promise<StatementLike[]> {
  const role = agendaCreditRoleSchema.parse(input.speaker.proposalRole);
  const state = await first<{ revision: number; missing_count: number; content_missing: number }>(
    db,
    `SELECT state.revision,
       (SELECT COUNT(*) FROM event_agenda_occurrences occurrence
        WHERE occurrence.event_id=state.event_id AND ${proposalOccurrenceSql("occurrence")}
          AND NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker
                         WHERE speaker.occurrence_id=occurrence.id AND speaker.user_id=?)) AS missing_count,
       EXISTS(SELECT 1 FROM event_agenda_contents content
              WHERE content.event_id=state.event_id AND content.source_key='proposal:'||?
                AND NOT EXISTS(SELECT 1 FROM json_each(content.speaker_user_ids_json) WHERE value=?)) AS content_missing
     FROM event_agenda_state state WHERE state.event_id=?`,
    [input.proposalId, input.proposalId, input.speaker.userId, input.proposalId, input.speaker.userId, input.eventId],
  );
  // Without an agenda there is nothing placed to credit and no revision to guard.
  if (!state) return [];
  const { revision } = state;
  if (!state.missing_count && !state.content_missing) return [prepareAgendaRevisionGuard(db, input.eventId, revision)];
  // The proposal's content gains the speaker too, so a later placement credits them as well.
  const statements: StatementLike[] = [
    prepareAgendaRevisionGuard(db, input.eventId, revision),
    db
      .prepare(
        `UPDATE event_agenda_contents
            SET speaker_user_ids_json=json_insert(speaker_user_ids_json,'$[#]',?),
                speaker_roles_json=json_set(COALESCE(speaker_roles_json,'{}'),'$."'||?||'"',?),
                updated_at=?
          WHERE event_id=? AND source_key='proposal:'||?
            AND NOT EXISTS(SELECT 1 FROM json_each(speaker_user_ids_json) WHERE value=?)`,
      )
      .bind(
        input.speaker.userId,
        input.speaker.userId,
        role,
        input.at,
        input.eventId,
        input.proposalId,
        input.speaker.userId,
      ),
  ];
  statements.push(
    db
      .prepare(
        `INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id)
       SELECT occurrence.id, ?, ?, 'physical', NULL FROM event_agenda_occurrences occurrence
       WHERE occurrence.event_id=? AND ${proposalOccurrenceSql("occurrence")}
         AND NOT EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker
                        WHERE speaker.occurrence_id=occurrence.id AND speaker.user_id=?)
       ON CONFLICT(occurrence_id,user_id) DO NOTHING`,
      )
      .bind(input.speaker.userId, role, input.eventId, input.proposalId, input.proposalId, input.speaker.userId),
    prepareScopedAuditLog(
      db,
      { type: "event", id: input.eventId },
      input.actor.type,
      input.actor.id,
      "agenda.speaker_confirmed",
      "event_agenda",
      input.eventId,
      {
        proposalId: input.proposalId,
        occurrenceCount: state.missing_count,
        fromRevision: revision,
        toRevision: revision + 1,
      },
    ),
    ...prepareEventSpeakingStanding(db, input.at, { eventId: input.eventId, nextAgendaRevision: true }),
    ...prepareAgendaScheduleGuard(db, input.eventId),
    db
      .prepare("UPDATE event_agenda_state SET revision=revision+1,updated_at=? WHERE event_id=? AND revision=?")
      .bind(input.at, input.eventId, revision),
  );
  return statements;
}
