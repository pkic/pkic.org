import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { SPEAKER_ACCEPTANCE_REQUIRED_MESSAGE } from "../../../../assets/shared/proposal-speaker-acceptance";
import { appearanceActingIdentityId } from "../../../../assets/shared/schemas/event-session-history";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaHistoricalPublicationReview } from "../../../../assets/shared/agenda-historical-publication-review";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
import { agendaContentSourceSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-source-snapshot";
import {
  historicalReviewMetadataSchema,
  historicalReviewPersonSchema,
  historicalReviewSourceSchema,
} from "../../../../assets/shared/schemas/event-agenda-historical-review";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferTimingSchema,
} from "../../../../assets/shared/schemas/event-agenda-transfer";
import { agendaTransferModePolicy } from "../../../../assets/shared/event-agenda-transfer";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, D1StatementResult } from "../../types";
import { nowIso } from "../../utils/time";
import { parseJsonSafe } from "../../utils/json";
import {
  historicalSourceGuard,
  prepareHistoricalOccurrenceSources,
  type HistoricalSourceRow,
} from "./historical-mapping-import";

function historicalEvidenceRequired(): never {
  throw new AppError(
    422,
    "AGENDA_HISTORICAL_MAPPING_REQUIRED",
    "Historical source attribution requires exact accepted past source evidence. Prepare a new source review.",
  );
}

/** Retained attribution is reviewed as source evidence, never as canonical identity approval. */
function assertHistoricalPublicationSource(
  row: HistoricalSourceRow,
  occurrence: AgendaSnapshot["occurrences"][number],
  approvalTime: number,
) {
  const metadata = historicalReviewMetadataSchema.safeParse(
    row.metadata_json === null ? {} : parseJsonSafe<unknown>(row.metadata_json, undefined),
  );
  const source = agendaContentSourceSnapshotSchema.safeParse(
    parseJsonSafe<unknown>(row.source_snapshot_json, undefined),
  );
  const timing = transferTimingSchema.safeParse(parseJsonSafe<unknown>(row.timing_json, undefined));
  const people = historicalReviewPersonSchema
    .array()
    .max(30)
    .safeParse(parseJsonSafe<unknown>(row.people_json, undefined));
  const original = historicalReviewSourceSchema.safeParse({
    sourcePath: row.source_path,
    sourceDigest: row.source_digest,
    sourceRef: row.source_ref,
  });
  const publishedMetadata = historicalReviewMetadataSchema.safeParse(occurrence.history ?? {});
  if (
    row.import_mode !== "archive" ||
    !metadata.success ||
    !source.success ||
    !timing.success ||
    !people.success ||
    !original.success ||
    !publishedMetadata.success ||
    !agendaTransferSchema.shape.source.shape.kind.safeParse(row.source_format).success ||
    !agendaTransferSchema.shape.version.safeParse(row.source_version).success ||
    !row.imported_by ||
    !utcInstantSchema.safeParse(row.imported_at).success ||
    Date.parse(row.imported_at) > approvalTime ||
    row.id !== occurrence.id ||
    row.content_id !== occurrence.contentId ||
    row.title !== occurrence.title ||
    row.start_at !== occurrence.startAt ||
    row.end_at !== occurrence.endAt ||
    !timing.data.startAt ||
    Date.parse(timing.data.startAt) >= approvalTime ||
    (timing.data.endAt !== null &&
      (timing.data.endAt <= timing.data.startAt || Date.parse(timing.data.endAt) >= approvalTime)) ||
    JSON.stringify(metadata.data) !== JSON.stringify(publishedMetadata.data)
  )
    historicalEvidenceRequired();

  const acceptedSources = [original.data, ...source.data.retainedSourceEvidence];
  const matchesSource = (value: { sourcePath: string; sourceDigest: string }) =>
    acceptedSources.some(
      (receipt) => receipt.sourcePath === value.sourcePath && receipt.sourceDigest === value.sourceDigest,
    );
  const matchesLocator = (value: { sourcePath: string; sourceDigest: string; sourceLocator: string }) =>
    acceptedSources.some(
      (receipt) =>
        receipt.sourcePath === value.sourcePath &&
        receipt.sourceDigest === value.sourceDigest &&
        receipt.sourceRef === value.sourceLocator,
    );
  const { archivalTiming, archivalCredits, sourceDecisions, appearances } = metadata.data;
  if (occurrence.startAt !== null || occurrence.endAt !== null) {
    if (
      !occurrence.startAt ||
      !occurrence.endAt ||
      occurrence.startAt >= occurrence.endAt ||
      timing.data.startAt !== occurrence.startAt ||
      timing.data.endAt !== occurrence.endAt ||
      Date.parse(occurrence.endAt) >= approvalTime ||
      archivalTiming !== null
    )
      historicalEvidenceRequired();
  } else if (
    !archivalTiming ||
    !matchesSource(archivalTiming) ||
    Date.parse(archivalTiming.startAt) >= approvalTime ||
    timing.data.startAt !== archivalTiming.startAt ||
    timing.data.endAt !== null ||
    timing.data.endSource !== "unresolved" ||
    timing.data.timeZone !== archivalTiming.timeZone ||
    timing.data.authoredDate !== archivalTiming.authoredDate ||
    timing.data.authoredStart !== archivalTiming.authoredStart
  )
    historicalEvidenceRequired();

  if (
    new Set(people.data.map((person) => person.sourceRef)).size !== people.data.length ||
    new Set(archivalCredits.map((credit) => credit.sourceRef)).size !== archivalCredits.length ||
    archivalCredits.some(
      (credit) =>
        !matchesSource(credit) ||
        !people.data.some(
          (person) =>
            person.sourceRef === credit.sourceRef && person.userId === null && person.actingIdentityId === null,
        ),
    ) ||
    new Set(
      sourceDecisions.map((decision) =>
        JSON.stringify([
          decision.kind,
          decision.sourceLocator,
          ...(decision.kind === "credit" ? [decision.authoredValue] : []),
        ]),
      ),
    ).size !== sourceDecisions.length ||
    sourceDecisions.some(
      (decision) =>
        !matchesLocator(decision) ||
        Date.parse(decision.reviewedAt) > approvalTime ||
        (decision.kind === "title" && decision.resolvedValue !== occurrence.title) ||
        (decision.decision === "credit_not_recorded" &&
          people.data.some((person) => person.sourceRef === decision.authoredValue)) ||
        (decision.decision === "retain_source_credit" &&
          !archivalCredits.some((credit) => credit.displayName === decision.resolvedValue)) ||
        (decision.decision === "reviewed_credit" &&
          !people.data.some(
            (person) =>
              person.sourceRef === decision.resolvedValue &&
              person.userId !== null &&
              occurrence.speakers.some((speaker) => speaker.userId === person.userId) &&
              appearances.some(
                (appearance) =>
                  appearance.userId === person.userId &&
                  appearanceActingIdentityId(appearance) === person.actingIdentityId &&
                  Date.parse(appearance.approvedAt) <= approvalTime,
              ),
          )),
    )
  )
    historicalEvidenceRequired();
}

/** Canonical speakers still require approved appearances, including in mixed archival rosters. */
export function preparePublicationRepresentationsRead(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
  acknowledgeArchiveRepresentation = false,
) {
  const approvalTime = Date.parse(nowIso());
  const historical = prepareHistoricalOccurrenceSources(
    db,
    eventId,
    snapshot.occurrences.map((occurrence) => occurrence.id),
  );
  const unaccepted = unacceptedProposalSpeakerEvidence(eventId, snapshot);
  return {
    statements: [...historical.statements, db.prepare(`${unaccepted.sql} LIMIT 1`).bind(...unaccepted.bindings)],
    decode(loaded: D1StatementResult[]): StatementLike[] {
      if (
        snapshot.occurrences.some((occurrence) =>
          occurrence.history?.appearances.some((appearance) => Date.parse(appearance.approvedAt) > approvalTime),
        )
      )
        throw new AppError(
          422,
          "APPEARANCE_APPROVAL_IN_FUTURE",
          "An appearance approval cannot be dated in the future.",
        );
      const { occurrenceIds } = agendaHistoricalPublicationReview(snapshot);
      const required = new Set(occurrenceIds);
      const occurrences = new Map(snapshot.occurrences.map((occurrence) => [occurrence.id, occurrence]));
      const rows = historical.decode(loaded.slice(0, historical.statements.length));
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (byId.size !== rows.length || occurrenceIds.some((id) => !byId.has(id))) historicalEvidenceRequired();
      for (const row of rows) {
        const occurrence = occurrences.get(row.id);
        const mode = transferPrepareSchema.shape.mode.safeParse(row.import_mode);
        const timing = transferTimingSchema.safeParse(parseJsonSafe<unknown>(row.timing_json, undefined));
        if (
          !occurrence ||
          !mode.success ||
          !timing.success ||
          !agendaTransferSchema.shape.source.shape.kind.safeParse(row.source_format).success
        )
          historicalEvidenceRequired();
        // Current and copied imports carry no archival attribution; they publish as ordinary authored sessions.
        if (agendaTransferModePolicy[mode.data].attribution !== "archival") {
          if (required.has(row.id)) historicalEvidenceRequired();
          continue;
        }
        const pastSource =
          timing.data.startAt !== null &&
          Date.parse(timing.data.startAt) < approvalTime &&
          (timing.data.endAt === null || Date.parse(timing.data.endAt) < approvalTime);
        if (row.source_format === "hugo" || pastSource || required.has(row.id))
          assertHistoricalPublicationSource(row, occurrence, approvalTime);
      }
      if (occurrenceIds.length && !acknowledgeArchiveRepresentation)
        throw new AppError(
          400,
          "AGENDA_PUBLICATION_ARCHIVE_REVIEW_REQUIRED",
          "Confirm the retained historical source attribution and unknown facts before approving this agenda.",
        );
      const guards: StatementLike[] = [];
      for (let offset = 0; offset < rows.length; offset += 100)
        guards.push(historicalSourceGuard(db, eventId, rows.slice(offset, offset + 100)));
      const missing = snapshot.occurrences.some((occurrence) =>
        occurrence.speakers.some(
          (speaker) =>
            !occurrence.history?.appearances.some(
              (appearance) => appearance.userId === speaker.userId && appearance.approvedAt,
            ),
        ),
      );
      if (missing)
        throw new AppError(
          422,
          "AGENDA_REPRESENTATION_REVIEW_REQUIRED",
          "Review and approve each speaker's representation before approving this agenda.",
        );
      if (batchFirst(loaded[historical.statements.length]))
        throw new AppError(422, "AGENDA_SPEAKER_ACCEPTANCE_REQUIRED", SPEAKER_ACCEPTANCE_REQUIRED_MESSAGE);
      // Pinned at commit too: a speaker who withdraws their acceptance meanwhile is never published.
      guards.push(
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 WHERE NOT EXISTS(${unaccepted.sql})`,
          bindings: unaccepted.bindings,
        }),
      );
      return guards;
    },
  };
}

/**
 * A speaker on a proposal's session who has not personally accepted that
 * proposal's invitation: the proposer's acceptance never stands in for theirs,
 * so the public agenda never shows them.
 */
function unacceptedProposalSpeakerEvidence(eventId: string, snapshot: AgendaSnapshot) {
  return {
    sql: `SELECT occurrence.id FROM event_agenda_occurrences occurrence
     JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id
     JOIN proposal_speakers roster
       ON roster.user_id=speaker.user_id AND (occurrence.source_key='proposal:'||roster.proposal_id OR occurrence.content_id IN(
         SELECT content.id FROM event_agenda_contents content
          WHERE content.event_id=occurrence.event_id AND content.source_key='proposal:'||roster.proposal_id))
     WHERE occurrence.event_id=? AND occurrence.id IN(SELECT value FROM json_each(?)) AND roster.status<>'confirmed'`,
    bindings: [eventId, JSON.stringify(snapshot.occurrences.map((occurrence) => occurrence.id))] as unknown[],
  };
}
