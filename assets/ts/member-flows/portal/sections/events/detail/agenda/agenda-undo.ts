import { agendaOccurrencePatchSchema, type AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";

/** The guarded patch that puts one edited occurrence back as it was before the last save. */
export function agendaOccurrenceRestorePatch(previous: AgendaOccurrence, expectedRevision: number) {
  return agendaOccurrencePatchSchema.parse({
    expectedRevision,
    title: previous.title,
    description: previous.description,
    startAt: previous.startAt,
    endAt: previous.endAt,
    roomId: previous.roomId,
    additionalRoomIds: previous.additionalRoomIds ?? [],
    requiredEquipment: previous.requiredEquipment ?? [],
    plannedMedia: previous.plannedMedia ?? null,
    virtualRoomUrl: previous.virtualRoomUrl ?? null,
    accessPolicy: previous.accessPolicy,
    bookingOpensAt: previous.bookingOpensAt,
    bookingClosesAt: previous.bookingClosesAt,
    admissionPolicy: previous.admissionPolicy,
    capacity: previous.capacity,
    remoteCapacity: previous.remoteCapacity,
    presentationUrl: previous.presentationUrl,
    recordingUrl: previous.recordingUrl,
    visibility: previous.visibility,
    kind: previous.kind,
    track: previous.track ?? null,
    format: previous.format ?? null,
    placeholder: previous.placeholder ?? false,
    speakerUserIds: previous.speakers.map((speaker) => speaker.userId),
    speakerRoles: Object.fromEntries(previous.speakers.map((speaker) => [speaker.userId, speaker.role ?? "speaker"])),
    speakerPlacements: Object.fromEntries(
      previous.speakers.map((speaker) => [
        speaker.userId,
        { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
      ]),
    ),
  });
}
