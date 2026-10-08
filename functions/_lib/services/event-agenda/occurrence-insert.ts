import type { z } from "zod";
import type { agendaOccurrenceCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";

/** New manual occurrences use the same stored fields regardless of the authoring surface. */
export function prepareAgendaOccurrenceInsert(
  db: DatabaseLike,
  eventId: string,
  id: string,
  input: z.infer<typeof agendaOccurrenceCreateSchema>,
) {
  return db
    .prepare(
      "INSERT INTO event_agenda_occurrences(id,event_id,title,description,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility,kind,track,presentation_url,recording_url,access_policy,booking_opens_at,booking_closes_at,required_equipment_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      eventId,
      input.title,
      input.description,
      input.startAt,
      input.endAt,
      input.roomId,
      input.admissionPolicy,
      input.capacity,
      input.remoteCapacity,
      input.visibility,
      input.kind,
      input.track ?? null,
      input.presentationUrl ?? null,
      input.recordingUrl ?? null,
      input.accessPolicy ?? "open",
      input.bookingOpensAt ?? null,
      input.bookingClosesAt ?? null,
      JSON.stringify(input.requiredEquipment ?? []),
    );
}
