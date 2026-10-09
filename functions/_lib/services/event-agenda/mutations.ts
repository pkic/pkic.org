import { prepareAgendaOccurrenceSettings } from "./occurrence-settings";
import { prepareAgendaSponsorApproval } from "./sponsors";
import { prepareAgendaOccurrenceInsert, plannedMediaJson } from "./occurrence-insert";
import { agendaOccurrenceRequiredEquipment } from "../../../../assets/shared/event-agenda-media";
import { agendaEventWindowViolations } from "../../../../assets/shared/event-agenda-event-window";
import { prepareAgendaRoomOrder } from "./room-order-settings";
import { preparePublicAgendaSnapshot } from "./public-snapshot";
import { occurrenceRepresentationReferences, prepareRepresentationEligibility } from "./representation-eligibility";
import { assertPublicationRepresentations } from "./publication-representations";
import { agendaHistoricalPublicationReview } from "../../../../assets/shared/agenda-historical-publication-review";
import { prepareScopedAuditLog } from "../audit";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { operationalDays, prepareOperationalDays } from "./operational-days";
import { operationalPeople, prepareOperationalPeople } from "./operational-people";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
export { saveAgendaStaffing, allocateStaffing } from "./staffing";
export { commitAgendaRevision } from "./revision";
import { commitAgendaRevision } from "./revision";
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
import {
  agendaSettingsSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRoomCreateSchema,
  type AgendaSnapshot,
} from "../../../../assets/shared/schemas/event-agenda";
import { agendaConflicts, agendaRoomIsAvailable } from "../../../../assets/shared/event-agenda-policy";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { getAgenda, getAgendaOccurrence } from "./read";
import { canonicalAgendaSessionFormats, readAgendaSessionFormatLabels } from "./occurrence-formats";
import {
  agendaScheduleConflictProposalSchema,
  agendaScheduleConflictDetailsSchema,
  type AgendaScheduleConflictProposal,
} from "../../../../assets/shared/schemas/event-agenda-schedule";

export function agendaSpeakerStatements(
  db: DatabaseLike,
  id: string,
  userIds: string[],
  roles?: Record<string, string>,
  placements?: Record<string, { attendanceMode: "physical" | "remote"; roomId: string | null }>,
) {
  return [
    ...userIds.map((userId) =>
      db
        .prepare(
          "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,COALESCE(?,(SELECT role FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?),'speaker'),COALESCE(?,(SELECT attendance_mode FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?),'physical'),CASE WHEN ? THEN ? ELSE (SELECT room_id FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?) END) ON CONFLICT(occurrence_id,user_id) DO UPDATE SET role=COALESCE(?,role),attendance_mode=COALESCE(?,attendance_mode),room_id=CASE WHEN ? THEN ? ELSE room_id END",
        )
        .bind(
          id,
          userId,
          roles?.[userId] ?? null,
          id,
          userId,
          placements?.[userId]?.attendanceMode ?? null,
          id,
          userId,
          placements?.[userId] ? 1 : 0,
          placements?.[userId]?.roomId ?? null,
          id,
          userId,
          roles?.[userId] ?? null,
          placements?.[userId]?.attendanceMode ?? null,
          placements?.[userId] ? 1 : 0,
          placements?.[userId]?.roomId ?? null,
        ),
    ),
    db
      .prepare(
        "DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id NOT IN(SELECT value FROM json_each(?))",
      )
      .bind(id, JSON.stringify(userIds)),
  ];
}
export async function createAgendaRoom(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaRoomCreateSchema>,
  actorUserId: string | null = null,
) {
  const id = crypto.randomUUID();
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const roomOrder = await prepareAgendaRoomOrder(db, eventId, [...snapshot.rooms.map((room) => room.id), id]);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      db
        .prepare(
          "INSERT INTO event_agenda_rooms(id,event_id,name,capacity,setup_minutes,equipment_json,available_periods_json,virtual_room_url) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.name,
          input.capacity,
          input.setupMinutes,
          JSON.stringify(input.equipment ?? []),
          JSON.stringify(input.availablePeriods ?? []),
          input.virtualRoomUrl ?? null,
        ),
      ...roomOrder,
    ],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
export async function createAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  requested: z.infer<typeof agendaOccurrenceCreateSchema>,
  actorUserId: string | null = null,
) {
  const id = crypto.randomUUID();
  const [input] = canonicalAgendaSessionFormats(await readAgendaSessionFormatLabels(db, eventId), [requested]);
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const candidate = {
    ...input,
    id,
    speakers: input.speakerUserIds.map((userId) => ({
      userId,
      displayName: "",
      ...input.speakerPlacements?.[userId],
      role: input.speakerRoles?.[userId],
    })),
  };
  const conflictProposal = agendaScheduleConflictProposalSchema.parse({
    timeZone: snapshot.timeZone,
    occurrences: [candidate],
  });
  validateAgendaSchedule(snapshot, [...snapshot.occurrences, candidate], conflictProposal);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      prepareAgendaOccurrenceInsert(db, eventId, id, input),
      ...agendaAdditionalRoomStatements(db, id, input.additionalRoomIds ?? []),
      ...agendaSpeakerStatements(db, id, input.speakerUserIds, input.speakerRoles, input.speakerPlacements),
      ...(await prepareAgendaOccurrenceSettings(db, eventId, [candidate])),
    ],
    actorUserId,
    conflictProposal,
  );
  return getAgenda(db, eventId, eventSlug);
}
export function validateAgendaSchedule(
  snapshot: Pick<
    AgendaSnapshot,
    "travelMinutes" | "rooms" | "eventStartsAt" | "eventEndsAt" | "shifts" | "assignments"
  >,
  items: AgendaSnapshot["occurrences"],
  conflictProposal?: AgendaScheduleConflictProposal,
) {
  const conflicts = agendaConflicts(items, snapshot.travelMinutes, snapshot.rooms);
  for (const item of items) {
    if (item.bookingOpensAt && item.bookingClosesAt && item.bookingOpensAt >= item.bookingClosesAt)
      conflicts.push(`${item.title}: booking closing time must follow opening time`);
    const outside = agendaEventWindowViolations(item, snapshot);
    if (outside.startsBefore) conflicts.push(`${item.title}: session starts before the event`);
    if (outside.endsAfter) conflicts.push(`${item.title}: session ends after the event`);
    if (Boolean(item.startAt) !== Boolean(item.endAt)) conflicts.push(`${item.title}: both start and end are required`);
    if ((item.additionalRoomIds?.length ?? 0) > 0 && !item.roomId)
      conflicts.push(`${item.title}: choose a primary room`);
    if (item.roomId && item.additionalRoomIds?.includes(item.roomId))
      conflicts.push(`${item.title}: primary room is already reserved`);
    const roomIds = agendaOccurrenceRoomIds(item);
    for (const speaker of item.speakers) {
      if (speaker.attendanceMode !== "remote" && speaker.roomId && !roomIds.includes(speaker.roomId))
        conflicts.push(`${item.title}: a physical speaker location is not reserved for this session`);
      if (speaker.attendanceMode === "remote" && speaker.roomId)
        conflicts.push(`${item.title}: a remote speaker cannot have a physical location`);
    }
    for (const roomId of roomIds) {
      const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
      if (!room) {
        conflicts.push(`${item.title}: room does not belong to this event`);
        continue;
      }
      if (item.startAt && item.endAt && !agendaRoomIsAvailable(room, item.startAt, item.endAt))
        conflicts.push(`${item.title}: ${room.name} is unavailable for this session and setup time`);
      for (const equipment of agendaOccurrenceRequiredEquipment(item))
        if (!room.equipment?.includes(equipment))
          conflicts.push(`${item.title}: ${room.name} does not provide ${equipment}`);
      if (roomIds.length === 1 && room.capacity !== null && item.capacity !== null && item.capacity > room.capacity)
        conflicts.push(`${item.title}: session capacity exceeds room capacity`);
    }
  }
  for (const shift of snapshot.shifts) {
    const room = snapshot.rooms.find((candidate) => candidate.id === shift.roomId);
    if (room && !agendaRoomIsAvailable(room, shift.startAt, shift.endAt, false))
      conflicts.push(`${shift.name}: ${room.name} is unavailable for this staffing shift`);
  }
  for (const assignment of snapshot.assignments) {
    const shift = snapshot.shifts.find((item) => item.id === assignment.shiftId);
    if (
      shift &&
      items.some(
        (item) =>
          item.startAt &&
          item.endAt &&
          item.startAt < shift.endAt &&
          shift.startAt < item.endAt &&
          item.speakers.some((speaker) => speaker.userId === assignment.userId),
      )
    )
      conflicts.push("A speaker has an overlapping shift duty");
  }
  if (conflicts.length)
    throw new AppError(
      409,
      "AGENDA_SCHEDULE_CONFLICT",
      "This change conflicts with the agenda",
      agendaScheduleConflictDetailsSchema.parse({ conflicts, proposal: conflictProposal }),
    );
}
export async function patchAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  id: string,
  requested: z.infer<typeof agendaOccurrencePatchSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const existing = await getAgendaOccurrence(db, eventId, id);
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
  await commitAgendaRevision(db, eventId, input.expectedRevision, statements, actorUserId, conflictProposal);
  return getAgenda(db, eventId, eventSlug);
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
  const approvedSnapshot = preparePublicAgendaSnapshot(snapshot, nextRevision, nowIso(), event.visibility === "public");
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
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND visibility=?",
        bindings: [eventId, event.visibility],
      }),
      ...representationGuards,
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
  return getAgenda(db, eventId, eventSlug);
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
  await commitAgendaRevision(
    db,
    eventId,
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
  return getAgenda(db, eventId, eventSlug);
}
