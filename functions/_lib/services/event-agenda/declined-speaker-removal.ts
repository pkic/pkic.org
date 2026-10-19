import { prepareEventSpeakingStanding } from "../member-standing/event-speaking";
import { all, first } from "../../db/queries";
import { listPermissionHolders } from "../../auth/permission-holders";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { emailPlainText } from "../../email/plain-text";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { prepareScopedAuditLog } from "../audit";
import { prepareAgendaRevisionGuard } from "./revision";

/** At most this many organizers are told about one decline; the agenda itself shows the rest. */
const MAX_ORGANIZER_RECIPIENTS = 25;

/** An occurrence comes from a proposal when it, or the content it was placed from, carries the proposal's key. */
export function proposalOccurrenceSql(occurrenceAlias: string): string {
  return `(${occurrenceAlias}.source_key='proposal:'||? OR ${occurrenceAlias}.content_id IN(
    SELECT content.id FROM event_agenda_contents content
     WHERE content.event_id=${occurrenceAlias}.event_id AND content.source_key='proposal:'||?))`;
}

/**
 * Takes a speaker who declined off every session their proposal was placed
 * in, inside the caller's decline batch, and tells the event's agenda
 * organizers through the outbox. A session left without speakers stays where
 * it is and is flagged in that notice; nothing is unpublished.
 */
export async function prepareDeclinedSpeakerAgendaRemoval(
  db: DatabaseLike,
  input: {
    event: { id: string; slug: string; name: string };
    proposal: { id: string; title: string };
    speaker: { userId: string; name: string };
    appBaseUrl: string;
    at: string;
  },
): Promise<StatementLike[]> {
  const placed = await all<{ id: string; title: string; speaker_count: number }>(
    db,
    `SELECT occurrence.id, occurrence.title,
            (SELECT COUNT(*) FROM event_agenda_occurrence_speakers other WHERE other.occurrence_id=occurrence.id) AS speaker_count
       FROM event_agenda_occurrences occurrence
       JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id AND speaker.user_id=?
      WHERE occurrence.event_id=? AND ${proposalOccurrenceSql("occurrence")}
      ORDER BY occurrence.start_at, occurrence.id`,
    [input.speaker.userId, input.event.id, input.proposal.id, input.proposal.id],
  );
  // The proposal's content keeps its roster too, so a later placement does not bring the speaker back.
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE event_agenda_contents
            SET speaker_user_ids_json=(SELECT COALESCE(json_group_array(value),'[]') FROM json_each(speaker_user_ids_json) WHERE value<>?),
                speaker_roles_json=json_remove(speaker_roles_json,'$."'||?||'"'),
                updated_at=?
          WHERE event_id=? AND source_key='proposal:'||?
            AND EXISTS(SELECT 1 FROM json_each(speaker_user_ids_json) WHERE value=?)`,
      )
      .bind(
        input.speaker.userId,
        input.speaker.userId,
        input.at,
        input.event.id,
        input.proposal.id,
        input.speaker.userId,
      ),
  ];
  if (placed.length === 0) return statements;

  const revision =
    (
      await first<{ revision: number }>(db, "SELECT revision FROM event_agenda_state WHERE event_id=?", [
        input.event.id,
      ])
    )?.revision ?? 0;
  const occurrenceIds = JSON.stringify(placed.map((occurrence) => occurrence.id));
  const emptied = placed.filter((occurrence) => Number(occurrence.speaker_count) <= 1);
  statements.push(
    prepareAgendaRevisionGuard(db, input.event.id, revision),
    db
      .prepare(
        "DELETE FROM event_agenda_occurrence_speakers WHERE user_id=? AND occurrence_id IN(SELECT value FROM json_each(?))",
      )
      .bind(input.speaker.userId, occurrenceIds),
    prepareScopedAuditLog(
      db,
      { type: "event", id: input.event.id },
      "user",
      input.speaker.userId,
      "agenda.speaker_declined",
      "event_agenda",
      input.event.id,
      {
        proposalId: input.proposal.id,
        occurrenceIds: placed.map((occurrence) => occurrence.id),
        withoutSpeakers: emptied.map((occurrence) => occurrence.id),
        fromRevision: revision,
        toRevision: revision + 1,
      },
    ),
    ...prepareEventSpeakingStanding(db, input.at, { eventId: input.event.id, nextAgendaRevision: true }),
    db
      .prepare("UPDATE event_agenda_state SET revision=revision+1,updated_at=? WHERE event_id=? AND revision=?")
      .bind(input.at, input.event.id, revision),
  );

  // Told are exactly the people who may edit this event's agenda, resolved as every agenda request is authorized.
  const organizers = await listPermissionHolders(db, {
    permission: "agenda:write",
    context: { type: "event", id: input.event.id },
    limit: MAX_ORGANIZER_RECIPIENTS,
  });
  const agendaUrl = `${input.appBaseUrl}/portal/#/events/${encodeURIComponent(input.event.slug)}/agenda`;
  for (const organizer of organizers) {
    const key = `agenda-speaker-declined:${input.proposal.id}:${input.speaker.userId}:${revision}:${organizer.id}`;
    statements.push(
      prepareQueueEmailStatement(
        db,
        {
          outboxId: (await sha256Hex(key)).slice(0, 32),
          idempotencyKey: key,
          eventId: input.event.id,
          templateKey: "agenda_speaker_declined",
          recipientEmail: organizer.email,
          recipientUserId: organizer.id,
          messageType: "transactional",
          subject: `A speaker declined — ${input.event.name}`,
          data: {
            firstName: emailPlainText(organizer.first_name ?? ""),
            eventName: emailPlainText(input.event.name),
            speakerName: emailPlainText(input.speaker.name),
            proposalTitle: emailPlainText(input.proposal.title),
            sessionTitles: emailPlainText(placed.map((occurrence) => `- ${occurrence.title}`).join("\n")),
            sessionsWithoutSpeakers: emailPlainText(emptied.map((occurrence) => `- ${occurrence.title}`).join("\n")),
            agendaUrl,
          },
        },
        input.at,
      ).statement,
    );
  }
  return statements;
}
