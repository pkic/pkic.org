import { z } from "zod";
import type { agendaImportSchema } from "../../../../assets/shared/schemas/event-agenda";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { getAgenda } from "./read";
import { commitAgendaRevision, agendaSpeakerStatements, validateAgendaSchedule } from "./mutations";
export async function importAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaImportSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const existing = await all<{ source_key: string }>(
    db,
    "SELECT source_key FROM event_agenda_occurrences WHERE event_id=? AND source_key IS NOT NULL",
    [eventId],
  );
  let candidates = input.occurrences;
  if (input.source === "accepted_proposals") {
    const proposals = await all<{ id: string; title: string; abstract: string }>(
      db,
      "SELECT id,title,abstract FROM session_proposals WHERE event_id=? AND status='accepted' ORDER BY id LIMIT 101",
      [eventId],
    );
    if (proposals.length > 100)
      throw new AppError(422, "AGENDA_IMPORT_LIMIT", "Import accepted proposals in batches of at most 100");
    const speakers = await all<{ proposal_id: string; user_id: string }>(
      db,
      "SELECT speaker.proposal_id,speaker.user_id FROM proposal_speakers speaker JOIN session_proposals proposal ON proposal.id=speaker.proposal_id WHERE proposal.event_id=? AND proposal.status='accepted' AND speaker.status='confirmed' LIMIT 3000",
      [eventId],
    );
    candidates = proposals.map((proposal) => ({
      sourceKey: `proposal:${proposal.id}`,
      title: proposal.title,
      description: proposal.abstract,
      startAt: null,
      endAt: null,
      roomId: null,
      admissionPolicy: "preference",
      capacity: null,
      remoteCapacity: null,
      visibility: "public",
      kind: "session",
      speakerUserIds: speakers
        .filter((speaker) => speaker.proposal_id === proposal.id)
        .map((speaker) => speaker.user_id),
    }));
  }
  const fresh = candidates.filter((candidate) => !existing.some((item) => item.source_key === candidate.sourceKey));
  const items = fresh.map((candidate) => ({
    ...candidate,
    id: crypto.randomUUID(),
    speakers: candidate.speakerUserIds.map((userId) => ({ userId, displayName: "" })),
  }));
  validateAgendaSchedule(snapshot, [...snapshot.occurrences, ...items]);
  if (!input.dryRun && fresh.length) {
    const statements = items.flatMap((item) => [
      db
        .prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,description,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility,kind,source_key,presentation_url,recording_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          item.id,
          eventId,
          item.title,
          item.description,
          item.startAt,
          item.endAt,
          item.roomId,
          item.admissionPolicy,
          item.capacity,
          item.remoteCapacity,
          item.visibility,
          item.kind,
          item.sourceKey,
          item.presentationUrl ?? null,
          item.recordingUrl ?? null,
        ),
      ...agendaSpeakerStatements(db, item.id, item.speakerUserIds),
    ]);
    await commitAgendaRevision(db, eventId, input.expectedRevision, statements, actorUserId);
  }
  return {
    agenda: await getAgenda(db, eventId, eventSlug),
    imported: fresh.length,
    skipped: candidates.length - fresh.length,
    dryRun: input.dryRun,
  };
}
