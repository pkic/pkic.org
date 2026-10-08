import { prepareHistoricalMappingImports, type HistoricalMappingCandidate } from "./historical-mapping-import";
import { contentSpeakerStatements } from "./content-library";
import { agendaContentFieldsSchema } from "../../../../assets/shared/schemas/event-agenda-content";
import { prepareImportContentReviews } from "./import-content";
import { agendaAdditionalRoomStatements } from "./occurrence-rooms";
import { z } from "zod";
import { loadAcceptedProposalAgendaImport } from "./accepted-proposal-import";
import { prepareImportedProposalRepresentations } from "./proposal-representation-import";
import { occurrenceRepresentationReferences, prepareRepresentationEligibility } from "./representation-eligibility";
import {
  sessionHistoryMetadataSchema,
  type SessionProposalRepresentation,
} from "../../../../assets/shared/schemas/event-session-history";
import type { agendaImportSchema } from "../../../../assets/shared/schemas/event-agenda";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import type { DatabaseLike, StatementLike } from "../../types";
import { getAgenda } from "./read";
import { commitAgendaRevision, validateAgendaSchedule } from "./mutations";
export async function importAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaImportSchema>,
  actorUserId: string | null = null,
  metadata?: (item: { id: string; sourceKey: string }) => StatementLike[],
  historicalMappings: readonly HistoricalMappingCandidate[] = [],
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const existing = await all<{ id: string; source_key: string }>(
    db,
    "SELECT id,source_key FROM event_agenda_occurrences WHERE event_id=? AND source_key IS NOT NULL",
    [eventId],
  );
  let candidates = input.occurrences;
  let proposalStatuses: Map<string, string> | undefined;
  let placementFingerprint: string | undefined;
  let representations = new Map<string, SessionProposalRepresentation[]>();
  if (input.source === "accepted_proposals") {
    const imported = await loadAcceptedProposalAgendaImport(db, eventId, input.proposalIds);
    candidates = imported.candidates;
    proposalStatuses = imported.statuses;
    representations = imported.representations;
  }
  if (input.proposalPlacement) {
    const { proposalId, ...placement } = input.proposalPlacement;
    const sourceKey = `proposal:${proposalId}`;
    const importedContent = await all<{ id: string }>(
      db,
      "SELECT id FROM event_agenda_contents WHERE event_id=? AND source_key=? LIMIT 1",
      [eventId, sourceKey],
    );
    if (importedContent.length || existing.some((item) => item.source_key === sourceKey))
      throw new AppError(
        409,
        "AGENDA_PROPOSAL_ALREADY_IMPORTED",
        "This proposal is already in the agenda. Move its existing session instead.",
      );
    candidates = candidates.map((candidate) => ({ ...candidate, ...placement }));
    const candidate = candidates[0];
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          eventId,
          revision: snapshot.revision,
          expectedRevision: input.expectedRevision,
          candidate: {
            ...candidate,
            additionalRoomIds: [...(candidate.additionalRoomIds ?? [])].sort(),
            speakerUserIds: [...candidate.speakerUserIds].sort(),
            speakerRoles: Object.entries(candidate.speakerRoles ?? {}).sort(([a], [b]) => a.localeCompare(b)),
            proposalRepresentations: representations.get(candidate.sourceKey) ?? [],
          },
        }),
      ),
    );
    placementFingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!input.dryRun && input.expectedPlacementFingerprint !== placementFingerprint)
      throw new AppError(
        409,
        "AGENDA_PROPOSAL_REVIEW_CHANGED",
        "The proposal or placement changed. Review it again before adding it to the agenda.",
      );
  }
  const contentImport = await prepareImportContentReviews(db, eventId, snapshot, candidates, proposalStatuses);
  const fresh = candidates.filter((candidate) => !existing.some((item) => item.source_key === candidate.sourceKey));
  const items = fresh.map((candidate) => ({
    ...candidate,
    id: crypto.randomUUID(),
    speakers: candidate.speakerUserIds.map((userId) => ({ userId, displayName: "" })),
    ...(representations.has(candidate.sourceKey)
      ? {
          history: sessionHistoryMetadataSchema.parse({
            proposalRepresentations: representations.get(candidate.sourceKey),
          }),
        }
      : {}),
  }));
  validateAgendaSchedule(snapshot, [...snapshot.occurrences, ...items]);
  const historicalReferences = items.flatMap((item) => {
    const mapping = historicalMappings.find((source) => source.sourceKey === item.sourceKey);
    return (mapping?.incomingMetadata.appearances ?? [])
      .filter((appearance) => item.speakerUserIds.includes(appearance.userId))
      .map((appearance) => ({
        userId: appearance.userId,
        actingIdentityId: appearance.actingIdentityId,
        at: item.startAt ?? mapping?.incomingMetadata.archivalTiming?.startAt ?? null,
      }));
  });
  const representationGuards = await prepareRepresentationEligibility(db, [
    ...occurrenceRepresentationReferences(items),
    ...historicalReferences,
  ]);
  const representationImport = prepareImportedProposalRepresentations(
    db,
    eventId,
    snapshot,
    existing,
    candidates,
    representations,
    contentImport.contentIds,
  );
  const historicalImport = await prepareHistoricalMappingImports(
    db,
    eventId,
    snapshot,
    candidates.map((item) => ({
      ...agendaContentFieldsSchema.parse(item),
      sourceKey: item.sourceKey,
    })),
    historicalMappings,
    contentImport.contentIds,
  );
  if (
    !input.dryRun &&
    (fresh.length ||
      contentImport.statements.length ||
      representationImport.statements.length ||
      historicalImport.statements.length)
  ) {
    const statements = items.flatMap((item) => [
      db
        .prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,description,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility,kind,track,source_key,presentation_url,recording_url,required_equipment_json,content_id,access_policy,booking_opens_at,booking_closes_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
          item.track ?? null,
          item.sourceKey,
          item.presentationUrl ?? null,
          item.recordingUrl ?? null,
          JSON.stringify(item.requiredEquipment ?? []),
          contentImport.contentIds.get(item.sourceKey) ?? null,
          item.accessPolicy ?? "open",
          item.bookingOpensAt ?? null,
          item.bookingClosesAt ?? null,
        ),
      ...agendaAdditionalRoomStatements(db, item.id, item.additionalRoomIds ?? []),
      ...contentSpeakerStatements(db, item.id, agendaContentFieldsSchema.parse(item)),
      ...(item.history
        ? [
            db
              .prepare(
                "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
              )
              .bind(item.id, JSON.stringify(item.history), actorUserId, nowIso()),
          ]
        : []),
      ...(metadata?.(item) ?? []),
    ]);
    await commitAgendaRevision(
      db,
      eventId,
      input.expectedRevision,
      [
        ...representationGuards,
        ...historicalImport.guards,
        ...contentImport.statements,
        ...representationImport.statements,
        ...historicalImport.statements,
        ...statements,
      ],
      actorUserId,
    );
  }
  return {
    agenda: await getAgenda(db, eventId, eventSlug),
    imported: fresh.length,
    skipped: candidates.length - fresh.length,
    dryRun: input.dryRun,
    reviewRequired:
      contentImport.reviewRequired + representationImport.reviewRequired + historicalImport.reviewRequired,
    reviewSourceKeys: [
      ...new Set([
        ...contentImport.reviewSourceKeys,
        ...representationImport.reviewSourceKeys,
        ...historicalImport.reviewSourceKeys,
      ]),
    ],
    ...(placementFingerprint
      ? {
          placementFingerprint,
          placementPreview: {
            title: candidates[0].title,
            description: candidates[0].description,
            speakerCount: candidates[0].speakerUserIds.length,
          },
        }
      : {}),
  };
}
