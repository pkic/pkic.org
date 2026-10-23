import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import type { EventReadSelection } from "../events/selection";
import { readEventAdminResource } from "../events/authorized-context";
import { agendaWriteDatabase } from "./command-authorization";
import { prepareAgendaRead } from "./read";
import { prepareReviewedSpeakerProfilesRead } from "./speaker-profile-reviews";
import { validateAgendaSchedule } from "./schedule-validation";
import { preparePublicAgendaSnapshot } from "./public-snapshot";
import { preparePublicationRepresentationsRead } from "./publication-representations";
import { occurrenceRepresentationReferences, prepareRepresentationEligibilityRead } from "./representation-eligibility";
import { preparePublicationAllocationRead } from "./publication-allocations";
import {
  preparePublicationParticipationRead,
  preparePublicationParticipationChanges,
} from "../event-participation/publication-impact";
import { prepareAgendaChangeNotificationsRead } from "./notifications";
import { prepareSpeakerProfileSlugsRead } from "../people/profile-addresses";
import { prepareSessionPageSlugsRead } from "./session-page-slugs";
import { prepareAgendaSponsorApprovalRead } from "./sponsors";
import { operationalPeople, prepareOperationalPeople } from "./operational-people";
import { operationalDays, prepareOperationalDays } from "./operational-days";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { prepareScopedAuditLog } from "../audit";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { agendaHistoricalPublicationReview } from "../../../../assets/shared/agenda-historical-publication-review";
import { commitAgendaSnapshot } from "./commit-snapshot";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";

function preparePublicationSnapshot(db: DatabaseLike, event: EventReadSelection, eventSlug: string, revision: number) {
  const agenda = prepareAgendaRead(db, event, eventSlug);
  const profiles = prepareReviewedSpeakerProfilesRead(db, event);
  return {
    statements: [...agenda.statements, ...profiles.statements],
    async decode(loaded: D1StatementResult[], eventId: string) {
      const { snapshot, event } = agenda.decodeWithEvent(loaded.slice(0, agenda.statements.length));
      if (snapshot.publishedRevision === snapshot.revision)
        throw new AppError(409, "AGENDA_ALREADY_APPROVED", "This agenda revision is already approved");
      validateAgendaSchedule(snapshot, snapshot.occurrences);
      const nextRevision = revision + 1;
      const reviewed = await profiles.decode(loaded.slice(agenda.statements.length), eventId, snapshot);
      const approvedSnapshot = preparePublicAgendaSnapshot(
        reviewed.snapshot,
        nextRevision,
        nowIso(),
        event.visibility === "public",
      );
      return { snapshot, reviewed, approvedSnapshot, nextRevision, visibility: event.visibility };
    },
  };
}

type PublicationSnapshot = Awaited<ReturnType<ReturnType<typeof preparePublicationSnapshot>["decode"]>>;

export async function publishAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  userId: string,
  acknowledgeArchiveRepresentation = false,
) {
  const read = preparePublicationSnapshot(db, eventId, eventSlug, revision);
  const snapshot = await read.decode(await db.batch(read.statements), eventId);
  return commitPublication(db, eventId, eventSlug, revision, userId, snapshot, acknowledgeArchiveRepresentation);
}

export async function publishAgendaRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  revision: number,
  acknowledgeArchiveRepresentation = false,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:write", (event) => {
    const read = preparePublicationSnapshot(db, event, eventSlug, revision);
    return {
      statements: read.statements,
      async decode(loaded, event, actor) {
        const snapshot = await read.decode(loaded, event.id);
        return commitPublication(
          agendaWriteDatabase(db, actor, event.id),
          event.id,
          eventSlug,
          revision,
          actor.id,
          snapshot,
          acknowledgeArchiveRepresentation,
        );
      },
    };
  });
}

async function commitPublication(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  userId: string,
  plan: PublicationSnapshot,
  acknowledgeArchiveRepresentation: boolean,
) {
  const { snapshot, reviewed, approvedSnapshot, nextRevision, visibility } = plan;
  const readers = [
    preparePublicationRepresentationsRead(db, eventId, approvedSnapshot, acknowledgeArchiveRepresentation),
    prepareRepresentationEligibilityRead(db, occurrenceRepresentationReferences(approvedSnapshot.occurrences)),
    preparePublicationAllocationRead(db, snapshot),
    preparePublicationParticipationRead(db, eventId, approvedSnapshot),
    prepareAgendaChangeNotificationsRead(db, eventId, nextRevision, approvedSnapshot),
    prepareSpeakerProfileSlugsRead(db, approvedSnapshot, approvedSnapshot.approvedAt!),
    prepareSessionPageSlugsRead(db, eventId, approvedSnapshot, approvedSnapshot.approvedAt!),
    prepareAgendaSponsorApprovalRead(db, eventId, approvedSnapshot.occurrences),
  ];
  // These checks need the reviewed projection; their reads share one snapshot and their primary guards stay in the command.
  const loaded = await db.batch(readers.flatMap((read) => read.statements));
  let offset = 0;
  const [
    historicalGuards,
    representationGuards,
    allocationGuards,
    participationGuards,
    notificationStatements,
    profileSlugStatements,
    sessionSlugStatements,
    sponsorGuards,
  ] = readers.map((read) => {
    const results = loaded.slice(offset, offset + read.statements.length);
    offset += read.statements.length;
    return read.decode(results);
  });
  const privatePeople = operationalPeople(snapshot);
  const privateDays = operationalDays(snapshot);
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    revision,
    [
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM events WHERE id=? AND visibility=?",
        bindings: [eventId, visibility],
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
      ...sponsorGuards,
      ...allocationGuards,
      prepareOperationalPeople(db, eventId, nextRevision, privatePeople),
      prepareOperationalDays(db, eventId, nextRevision, privateDays),
      ...participationGuards,
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
