import type { z } from "zod";
import {
  agendaContentFieldsSchema,
  type agendaContentPlacementSchema,
} from "../../../../assets/shared/schemas/event-agenda-content";
import type { DatabaseLike } from "../../types";
import { getAgenda, getAgendaOccurrence } from "./read";
import { commitAgendaRevision } from "./revision";
import { placeAgendaContent, prepareCreateAgendaContent, prepareAgendaContentPlacement } from "./content-library";

/** Make legacy content reusable and add its repeated placement in the same revision. */
export async function placeAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  sourceId: string,
  input: z.infer<typeof agendaContentPlacementSchema>,
  actorId: string,
) {
  const source = await getAgendaOccurrence(db, eventId, sourceId);
  if (source.contentId)
    return placeAgendaContent(
      db,
      eventId,
      eventSlug,
      source.contentId,
      input.expectedRevision,
      input.copyAsNew,
      actorId,
    );
  const content = agendaContentFieldsSchema.parse({
    ...source,
    speakerUserIds: source.speakers.map((person) => person.userId),
    speakerRoles: Object.fromEntries(source.speakers.map((person) => [person.userId, person.role ?? "speaker"])),
  });
  const contentId = crypto.randomUUID(),
    occurrenceId = crypto.randomUUID();
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      prepareCreateAgendaContent(db, eventId, contentId, content),
      ...(!input.copyAsNew
        ? [
            db
              .prepare(
                "UPDATE event_agenda_occurrences SET content_id=? WHERE id=? AND event_id=? AND content_id IS NULL",
              )
              .bind(contentId, sourceId, eventId),
          ]
        : []),
      ...prepareAgendaContentPlacement(db, eventId, occurrenceId, contentId, content),
    ],
    actorId,
  );
  return { agenda: await getAgenda(db, eventId, eventSlug), occurrenceId, contentId };
}
