import { agendaMovedSpeakers } from "../../../../assets/shared/event-agenda-rooms";
import type { z } from "zod";
import {
  agendaScheduleApplySchema,
  agendaScheduleConflictProposalSchema,
  type AgendaScheduleProposal,
  type AgendaScheduleReview,
} from "../../../../assets/shared/schemas/event-agenda-schedule";
import { canonicalAgendaOrder } from "../../../../assets/shared/event-agenda-order";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { getAgenda } from "./read";
import { validateAgendaSchedule } from "./mutations";
import { assertPublicationCapacity, preparePublicationCapacityGuard } from "./publication-capacity";
import { agendaAdditionalRoomStatements } from "./occurrence-rooms";
import { commitAgendaRevision } from "./revision";
import { occurrenceRepresentationReferences, prepareRepresentationEligibility } from "./representation-eligibility";
async function prepare(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: AgendaScheduleProposal,
  actorId: string,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (snapshot.revision !== input.expectedRevision)
    throw new AppError(
      409,
      "AGENDA_REVISION_CHANGED",
      "Another organizer changed the agenda. Refresh before reviewing.",
    );
  const requested = new Map(input.changes.map((change) => [change.id, change]));
  if (input.changes.some((change) => !snapshot.occurrences.some((item) => item.id === change.id)))
    throw new AppError(404, "AGENDA_OCCURRENCE_NOT_FOUND", "A selected session no longer exists");
  const occurrences = snapshot.occurrences.map((item) => {
    const change = requested.get(item.id);
    if (!change) return item;
    if (
      Object.keys(change.speakerPlacements ?? {}).some(
        (userId) => !item.speakers.some((speaker) => speaker.userId === userId),
      )
    )
      throw new AppError(400, "AGENDA_SPEAKER_PLACEMENT_UNKNOWN", "Choose placements only for this session's speakers");
    return {
      ...item,
      ...change,
      speakers: agendaMovedSpeakers(item, change.roomId).map((speaker) => ({
        ...speaker,
        ...change.speakerPlacements?.[speaker.userId],
      })),
    };
  });
  const next = { ...snapshot, occurrences };
  const conflictProposal = agendaScheduleConflictProposalSchema.parse({
    timeZone: snapshot.timeZone,
    occurrences: occurrences.filter((item) => requested.has(item.id)),
  });
  validateAgendaSchedule(snapshot, occurrences, conflictProposal);
  const representationGuards = await prepareRepresentationEligibility(
    db,
    occurrenceRepresentationReferences(occurrences.filter((item) => requested.has(item.id))),
  );
  await assertPublicationCapacity(db, next);
  const beforeOrder = canonicalAgendaOrder(snapshot.occurrences),
    afterOrder = canonicalAgendaOrder(occurrences);
  const affected = snapshot.occurrences
    .filter((item) => requested.has(item.id))
    .map((before) => {
      const after = occurrences.find((item) => item.id === before.id)!;
      return {
        before,
        after,
        beforeOrder: before.startAt ? beforeOrder.findIndex((item) => item.id === before.id) + 1 : null,
        afterOrder: after.startAt ? afterOrder.findIndex((item) => item.id === after.id) + 1 : null,
      };
    });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ eventId, actorId, expectedRevision: input.expectedRevision, affected })),
  );
  const reviewHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    next,
    conflictProposal,
    representationGuards,
    review: { expectedRevision: input.expectedRevision, reviewHash, affected } satisfies AgendaScheduleReview,
  };
}
export async function reviewAgendaSchedule(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: AgendaScheduleProposal,
  actorId: string,
) {
  return (await prepare(db, eventId, eventSlug, input, actorId)).review;
}
export async function applyAgendaSchedule(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaScheduleApplySchema>,
  actorId: string,
) {
  const { next, review, representationGuards, conflictProposal } = await prepare(
    db,
    eventId,
    eventSlug,
    input,
    actorId,
  );
  if (review.reviewHash !== input.reviewHash)
    throw new AppError(
      409,
      "AGENDA_SCHEDULE_REVIEW_CHANGED",
      "The schedule preview changed. Review it again before applying.",
    );
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      preparePublicationCapacityGuard(db, next),
      ...representationGuards,
      ...review.affected.flatMap(({ before, after }) => [
        db
          .prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=?,room_id=? WHERE id=? AND event_id=?")
          .bind(after.startAt, after.endAt, after.roomId, after.id, eventId),
        ...agendaAdditionalRoomStatements(db, after.id, after.additionalRoomIds ?? []),
        ...speakerPlacementStatements(db, eventId, before, after),
      ]),
    ],
    actorId,
    conflictProposal,
  );
  return getAgenda(db, eventId, eventSlug);
}

function speakerPlacementStatements(
  db: DatabaseLike,
  eventId: string,
  before: AgendaScheduleReview["affected"][number]["before"],
  after: AgendaScheduleReview["affected"][number]["after"],
) {
  if (JSON.stringify(before.speakers) === JSON.stringify(after.speakers)) return [];
  const placements = JSON.stringify(
    Object.fromEntries(
      after.speakers.map((speaker) => [
        speaker.userId,
        { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
      ]),
    ),
  );
  return [
    db
      .prepare(
        "UPDATE event_agenda_occurrence_speakers SET attendance_mode=(SELECT json_extract(value,'$.attendanceMode') FROM json_each(?) placement WHERE placement.key=user_id),room_id=(SELECT json_extract(value,'$.roomId') FROM json_each(?) placement WHERE placement.key=user_id) WHERE occurrence_id=? AND user_id IN(SELECT key FROM json_each(?)) AND EXISTS(SELECT 1 FROM event_agenda_occurrences occurrence WHERE occurrence.id=occurrence_id AND occurrence.event_id=?)",
      )
      .bind(placements, placements, after.id, placements, eventId),
  ];
}
