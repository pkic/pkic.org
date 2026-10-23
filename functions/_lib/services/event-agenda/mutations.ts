export { createAgendaRoom } from "./create-room";
export { createAgendaOccurrence } from "./create-occurrence";
import { agendaSpeakerStatements } from "./occurrence-speakers";
import { validateAgendaSchedule } from "./schedule-validation";
export { agendaSpeakerStatements } from "./occurrence-speakers";
export { validateAgendaSchedule } from "./schedule-validation";
import { commitAgendaSnapshot } from "./commit-snapshot";
import { prepareAgendaOccurrenceSettings } from "./occurrence-settings";
import { prepareAgendaSponsorApproval } from "./sponsors";
import { plannedMediaJson } from "./occurrence-insert";
import { preparePublicAgendaSnapshot } from "./public-snapshot";
import { occurrenceRepresentationReferences, prepareRepresentationEligibility } from "./representation-eligibility";
import { assertPublicationRepresentations } from "./publication-representations";
import { prepareReviewedSpeakerProfiles } from "./speaker-profile-reviews";
import { agendaHistoricalPublicationReview } from "../../../../assets/shared/agenda-historical-publication-review";
import { prepareScopedAuditLog } from "../audit";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { operationalDays, prepareOperationalDays } from "./operational-days";
import { operationalPeople, prepareOperationalPeople } from "./operational-people";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
export { saveAgendaStaffing, allocateStaffing } from "./staffing";
export { commitAgendaRevision } from "./revision";
import { agendaAdditionalRoomStatements } from "./occurrence-rooms";
import {
  agendaOccurrenceRoomIds,
  agendaMovedSpeakers,
  agendaMovedAdditionalRoomIds,
} from "../../../../assets/shared/event-agenda-rooms";
import {
  assertPublicationParticipation,
  preparePublicationParticipationGuard,
  preparePublicationParticipationChanges,
} from "../event-participation/publication-impact";
import { physicalOccupiedSql, remoteOccupiedSql } from "../event-participation/capacity-accounting";
import { assertPublicationAllocations, preparePublicationAllocationGuard } from "./publication-allocations";
import { prepareAgendaChangeNotifications } from "./notifications";
import { z } from "zod";
import { agendaSettingsSchema, agendaOccurrencePatchSchema } from "../../../../assets/shared/schemas/event-agenda";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareSpeakerProfileSlugs } from "../people/profile-addresses";
import { prepareSessionPageSlugs } from "./session-page-slugs";
import { getAgenda } from "./read";
import { canonicalAgendaSessionFormats, readAgendaSessionFormatLabels } from "./occurrence-formats";
import { agendaScheduleConflictProposalSchema } from "../../../../assets/shared/schemas/event-agenda-schedule";

export async function patchAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  id: string,
  requested: z.infer<typeof agendaOccurrencePatchSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const existing = snapshot.occurrences.find((occurrence) => occurrence.id === id);
  if (!existing) throw new AppError(404, "AGENDA_OCCURRENCE_NOT_FOUND", "Session not found");
  // An unchanged format stays valid even if the event later retires that configured session type.
  const [input] =
    requested.format && requested.format !== existing.format
      ? canonicalAgendaSessionFormats(await readAgendaSessionFormatLabels(db, eventId), [
          { ...requested, title: requested.title ?? existing.title },
        ])
      : [requested];
  const item = {
    ...existing,
    ...input,
    additionalRoomIds:
      input.additionalRoomIds ??
      (input.roomId !== undefined && input.roomId !== existing.roomId
        ? agendaMovedAdditionalRoomIds(existing, input.roomId)
        : existing.additionalRoomIds),
    speakers: (input.speakerUserIds ?? existing.speakers.map((speaker) => speaker.userId)).map((userId) => ({
      userId,
      displayName: "",
      ...agendaMovedSpeakers(existing, input.roomId === undefined ? existing.roomId : input.roomId).find(
        (speaker) => speaker.userId === userId,
      ),
      ...input.speakerPlacements?.[userId],
      role: input.speakerRoles?.[userId] ?? existing.speakers.find((speaker) => speaker.userId === userId)?.role,
    })),
  };
  const conflictProposal = agendaScheduleConflictProposalSchema.parse({
    timeZone: snapshot.timeZone,
    occurrences: [item],
  });
  validateAgendaSchedule(
    snapshot,
    snapshot.occurrences.map((current) => (current.id === id ? item : current)),
    conflictProposal,
  );
  const physicalLimit = (session: typeof existing) =>
    session.capacity ??
    (agendaOccurrenceRoomIds(session).length <= 1
      ? (snapshot.rooms.find((room) => room.id === session.roomId)?.capacity ?? null)
      : null);
  // Capacity never blocks agenda work; only lowering a limit below confirmed attendance is refused.
  const loweredLimit = (next: number | null, previous: number | null) =>
    next !== null && (previous === null || next < previous) ? next : null;
  const effectiveCapacity = loweredLimit(physicalLimit(item), physicalLimit(existing));
  const remoteCapacity = loweredLimit(item.remoteCapacity, existing.remoteCapacity);
  if (effectiveCapacity !== null) {
    const bookings = await first<{ total: number }>(
      db,
      `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS total FROM target`,
      [id],
    );
    if ((bookings?.total ?? 0) > effectiveCapacity)
      throw new AppError(409, "AGENDA_RESERVED_CAPACITY", "The new capacity would displace confirmed attendees");
  }
  if (remoteCapacity !== null) {
    const remoteBookings = await first<{ total: number }>(
      db,
      `WITH target AS(SELECT ? AS id) SELECT ${remoteOccupiedSql("target.id")} AS total FROM target`,
      [id],
    );
    if ((remoteBookings?.total ?? 0) > remoteCapacity)
      throw new AppError(409, "AGENDA_RESERVED_CAPACITY", "The new capacity would displace confirmed attendees");
  }
  const proposed = {
    ...snapshot,
    occurrences: snapshot.occurrences.map((current) => (current.id === id ? item : current)),
  };
  await assertPublicationAllocations(db, proposed);
  const statements = [
    ...(await prepareRepresentationEligibility(db, occurrenceRepresentationReferences([item]))),
    preparePublicationAllocationGuard(db, proposed),
    db
      .prepare(
        "UPDATE event_agenda_occurrences SET title=?,description=?,start_at=?,end_at=?,room_id=?,admission_policy=?,capacity=?,remote_capacity=?,visibility=?,kind=?,track=?,format=?,placeholder=?,presentation_url=?,recording_url=?,access_policy=?,booking_opens_at=?,booking_closes_at=?,required_equipment_json=?,planned_media_json=? WHERE id=? AND event_id=?",
      )
      .bind(
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
        item.track ?? null,
        item.format ?? null,
        item.placeholder ? 1 : 0,
        item.presentationUrl ?? null,
        item.recordingUrl ?? null,
        item.accessPolicy ?? "open",
        item.bookingOpensAt ?? null,
        item.bookingClosesAt ?? null,
        JSON.stringify(item.requiredEquipment ?? []),
        plannedMediaJson(item.plannedMedia),
        id,
        eventId,
      ),
  ];
  statements.push(
    ...(await prepareAgendaOccurrenceSettings(db, eventId, [
      {
        id,
        kind: item.kind,
        virtualRoomUrl: input.virtualRoomUrl,
        speakerUserIds:
          input.speakerUserIds ??
          (input.speakerIdentityIds ? item.speakers.map((speaker) => speaker.userId) : undefined),
        speakerIdentityIds: input.speakerIdentityIds,
        sponsorIds: input.sponsorIds ?? (input.kind !== undefined && input.kind !== "break" ? [] : undefined),
      },
    ])),
  );
  statements.push(...agendaAdditionalRoomStatements(db, id, item.additionalRoomIds ?? []));
  if (effectiveCapacity !== null)
    statements.unshift(
      prepareAuthorizationGuard(db, {
        sql: `WITH target AS(SELECT ? AS id) SELECT 1 FROM target WHERE ${physicalOccupiedSql("target.id")} <= ?`,
        bindings: [id, effectiveCapacity],
      }),
    );
  if (remoteCapacity !== null)
    statements.unshift(
      prepareAuthorizationGuard(db, {
        sql: `WITH target AS(SELECT ? AS id) SELECT 1 FROM target WHERE ${remoteOccupiedSql("target.id")} <= ?`,
        bindings: [id, remoteCapacity],
      }),
    );
  if (input.speakerUserIds || input.speakerPlacements || input.speakerRoles || item.roomId !== existing.roomId)
    statements.push(
      ...agendaSpeakerStatements(
        db,
        id,
        item.speakers.map((speaker) => speaker.userId),
        Object.fromEntries(item.speakers.map((speaker) => [speaker.userId, speaker.role ?? "speaker"])),
        Object.fromEntries(
          item.speakers.map((speaker) => [
            speaker.userId,
            { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
          ]),
        ),
      ),
    );
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    input.expectedRevision,
    statements,
    actorUserId,
    conflictProposal,
  );
}
export async function publishAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  userId: string,
  acknowledgeArchiveRepresentation = false,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (snapshot.publishedRevision === snapshot.revision)
    throw new AppError(409, "AGENDA_ALREADY_APPROVED", "This agenda revision is already approved");
  validateAgendaSchedule(snapshot, snapshot.occurrences);
  const nextRevision = revision + 1;
  const event = await first<{ visibility: string }>(db, "SELECT visibility FROM events WHERE id=?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const reviewed = await prepareReviewedSpeakerProfiles(db, eventId, snapshot);
  const approvedSnapshot = preparePublicAgendaSnapshot(
    reviewed.snapshot,
    nextRevision,
    nowIso(),
    event.visibility === "public",
  );
  const historicalGuards = await assertPublicationRepresentations(
    db,
    eventId,
    approvedSnapshot,
    acknowledgeArchiveRepresentation,
  );
  const representationGuards = await prepareRepresentationEligibility(
    db,
    occurrenceRepresentationReferences(approvedSnapshot.occurrences),
  );
  const privatePeople = operationalPeople(snapshot);
  const privateDays = operationalDays(snapshot);
  await assertPublicationAllocations(db, snapshot);
  await assertPublicationParticipation(db, eventId, approvedSnapshot);
  const notificationStatements = await prepareAgendaChangeNotifications(db, eventId, nextRevision, approvedSnapshot);
  const profileSlugStatements = await prepareSpeakerProfileSlugs(db, approvedSnapshot, approvedSnapshot.approvedAt!);
  const sessionSlugStatements = await prepareSessionPageSlugs(
    db,
    eventId,
    approvedSnapshot,
    approvedSnapshot.approvedAt!,
  );
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    revision,
    [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND visibility=?",
        bindings: [eventId, event.visibility],
      }),
      ...representationGuards,
      ...reviewed.guards,
      ...historicalGuards,
      ...(acknowledgeArchiveRepresentation && agendaHistoricalPublicationReview(approvedSnapshot).occurrenceIds.length
        ? [
            prepareScopedAuditLog(
              db,
              { type: "event", id: eventId },
              "user",
              userId,
              "agenda.archive.representation.acknowledged",
              "event_agenda",
              eventId,
              { revision: nextRevision, ...agendaHistoricalPublicationReview(approvedSnapshot) },
              approvedSnapshot.approvedAt,
            ),
          ]
        : []),
      ...(await prepareAgendaSponsorApproval(db, eventId, approvedSnapshot.occurrences)),
      preparePublicationAllocationGuard(db, snapshot),
      prepareOperationalPeople(db, eventId, nextRevision, privatePeople),
      prepareOperationalDays(db, eventId, nextRevision, privateDays),
      preparePublicationParticipationGuard(db, eventId, approvedSnapshot),
      ...notificationStatements,
      db
        .prepare(
          "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), eventId, nextRevision, JSON.stringify(approvedSnapshot), userId, nowIso()),
      db
        .prepare(
          "INSERT INTO event_agenda_published_occurrences(event_id,revision,occurrence_id,payload_json,room_json) SELECT ?,?,json_extract(occurrence.value,'$.id'),occurrence.value,(SELECT room.value FROM json_each(?,'$.rooms') room WHERE json_extract(room.value,'$.id')=json_extract(occurrence.value,'$.roomId')) FROM json_each(?,'$.occurrences') occurrence",
        )
        .bind(eventId, nextRevision, JSON.stringify(approvedSnapshot), JSON.stringify(approvedSnapshot)),
      db.prepare("UPDATE event_agenda_state SET published_revision=? WHERE event_id=?").bind(nextRevision, eventId),
      ...profileSlugStatements,
      ...sessionSlugStatements,
      prepareSitePublicationRequest(db, {
        resourceType: "event_agenda",
        resourceId: eventId,
        revision: nextRevision,
        reasonCode: "agenda_approved",
        deduplicationKey: `agenda:${eventId}:${nextRevision}`,
      }),
      ...preparePublicationParticipationChanges(db, eventId, approvedSnapshot),
    ],
    userId,
  );
}

export async function saveAgendaSettings(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaSettingsSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  validateAgendaSchedule({ ...snapshot, travelMinutes: input.travelMinutes }, snapshot.occurrences);
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    input.expectedRevision,
    [
      db.prepare("UPDATE event_agenda_state SET travel_minutes=? WHERE event_id=?").bind(input.travelMinutes, eventId),
      ...(input.durationRules
        ? [
            db
              .prepare(
                "UPDATE events SET settings_json=json_set(COALESCE(settings_json,'{}'),'$.agenda.durationRules',json(?)) WHERE id=?",
              )
              .bind(JSON.stringify(input.durationRules), eventId),
          ]
        : []),
    ],
    actorUserId,
  );
}
