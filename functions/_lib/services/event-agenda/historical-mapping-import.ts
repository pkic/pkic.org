import type { z } from "zod";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaContentFieldsSchema } from "../../../../assets/shared/schemas/event-agenda-content";
import {
  agendaHistoricalMetadataReviewSchema,
  historicalReviewMetadataSchema,
  historicalRetainedSourceEvidenceSchema,
  historicalMetadataReviewIssues,
  type HistoricalReviewPerson,
} from "../../../../assets/shared/schemas/event-agenda-historical-review";
import { all } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";

export type HistoricalMappingCandidate = {
  sourceKey: string;
  sourcePath: string;
  sourceDigest: string;
  sourceRef: string;
  retainedSourceEvidence: z.infer<typeof historicalRetainedSourceEvidenceSchema>;
  incomingMetadata: z.infer<typeof historicalReviewMetadataSchema>;
  people: HistoricalReviewPerson[];
};
export type HistoricalSourceRow = {
  id: string;
  content_id: string;
  source_key: string;
  start_at: string | null;
  metadata_json: string | null;
  source_review_json: string | null;
  source_snapshot_json: string | null;
  source_format: string;
  source_version: number;
  source_path: string;
  source_ref: string;
  source_anchor: string | null;
  source_digest: string;
  timing_json: string;
  media_json: string;
  people_json: string;
  imported_by: string | null;
  imported_at: string;
};
/** Exact stored source evidence is guarded independently of the agenda revision. */
export async function readHistoricalSources(db: DatabaseLike, eventId: string, sourceKeys: string[]) {
  return all<HistoricalSourceRow>(
    db,
    `SELECT occurrence.id,occurrence.content_id,occurrence.source_key,occurrence.start_at,
    history.metadata_json,content.source_review_json,content.source_snapshot_json,
    source.source_format,source.source_version,source.source_path,source.source_ref,source.source_anchor,
    source.source_digest,source.timing_json,source.media_json,source.people_json,source.imported_by,source.imported_at
    FROM event_agenda_occurrences occurrence
    JOIN event_agenda_contents content ON content.id=occurrence.content_id AND content.event_id=occurrence.event_id
    JOIN event_agenda_import_provenance source ON source.occurrence_id=occurrence.id
    LEFT JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id
    WHERE occurrence.event_id=? AND occurrence.source_key IN(SELECT value FROM json_each(?)) LIMIT 101`,
    [eventId, JSON.stringify(sourceKeys)],
  );
}
export function historicalSourceProvenance(row: HistoricalSourceRow) {
  return {
    sourceFormat: row.source_format,
    sourceVersion: row.source_version,
    sourcePath: row.source_path,
    sourceRef: row.source_ref,
    sourceAnchor: row.source_anchor,
    sourceDigest: row.source_digest,
    timingJson: row.timing_json,
    mediaJson: row.media_json,
    peopleJson: row.people_json,
    importedBy: row.imported_by,
    importedAt: row.imported_at,
  };
}
export function historicalSourceGuard(db: DatabaseLike, eventId: string, rows: HistoricalSourceRow[]) {
  const expected = rows.map((row) => ({
    provenance: historicalSourceProvenance(row),
    occurrence: {
      occurrenceId: row.id,
      sourceKey: row.source_key,
      contentId: row.content_id,
      startAt: row.start_at,
      metadataJson: row.metadata_json,
      reviewJson: row.source_review_json,
      snapshotJson: row.source_snapshot_json,
    },
  }));
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE NOT EXISTS(
      SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM event_agenda_occurrences occurrence
        JOIN event_agenda_contents content ON content.id=occurrence.content_id
        JOIN event_agenda_import_provenance source ON source.occurrence_id=occurrence.id
        LEFT JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id
        WHERE occurrence.event_id=? AND occurrence.id=json_extract(expected.value,'$.occurrence.occurrenceId') AND json_object(
          'provenance',json_object('sourceFormat',source.source_format,'sourceVersion',source.source_version,
            'sourcePath',source.source_path,'sourceRef',source.source_ref,'sourceAnchor',source.source_anchor,
            'sourceDigest',source.source_digest,'timingJson',source.timing_json,'mediaJson',source.media_json,
            'peopleJson',source.people_json,'importedBy',source.imported_by,'importedAt',source.imported_at),
          'occurrence',json_object('occurrenceId',occurrence.id,'sourceKey',occurrence.source_key,
            'contentId',occurrence.content_id,'startAt',occurrence.start_at,'metadataJson',history.metadata_json,
            'reviewJson',content.source_review_json,'snapshotJson',content.source_snapshot_json)) IS expected.value))`,
    bindings: [JSON.stringify(expected), eventId],
  });
}

export async function prepareHistoricalMappingImports(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
  candidates: Array<z.infer<typeof agendaContentFieldsSchema> & { sourceKey: string }>,
  mappings: readonly HistoricalMappingCandidate[],
  contentIds: Map<string, string>,
) {
  const statements: StatementLike[] = [],
    guards: StatementLike[] = [],
    reviewSourceKeys: string[] = [];
  if (!mappings.length) return { statements, guards, reviewRequired: 0, reviewSourceKeys };
  const rows = await readHistoricalSources(
    db,
    eventId,
    mappings.map((item) => item.sourceKey),
  );
  if (rows.length > 100)
    throw new AppError(422, "AGENDA_HISTORICAL_REVIEW_LIMIT", "Review at most 100 historical sessions.");
  let reviewRequired = 0;
  const guarded: HistoricalSourceRow[] = [];
  for (const mapping of mappings) {
    const row = rows.find((item) => item.source_key === mapping.sourceKey);
    const occurrence = row ? snapshot.occurrences.find((item) => item.id === row.id) : null;
    if (!row || !occurrence) continue;
    const content = agendaContentFieldsSchema.parse(candidates.find((item) => item.sourceKey === mapping.sourceKey));
    const original = historicalReviewMetadataSchema.parse(row.metadata_json ? JSON.parse(row.metadata_json) : {});
    if (JSON.stringify(original) === JSON.stringify(mapping.incomingMetadata)) continue;
    const entry = agendaHistoricalMetadataReviewSchema.parse({
      ...mapping,
      occurrenceId: row.id,
      originalSource: { sourcePath: row.source_path, sourceDigest: row.source_digest, sourceRef: row.source_ref },
      expectedHistoryDigest: await sha256Hex(row.metadata_json ?? ""),
      expectedProvenanceDigest: await sha256Hex(JSON.stringify(historicalSourceProvenance(row))),
      originalMetadata: original,
      reviewIssues: historicalMetadataReviewIssues(
        original,
        mapping.incomingMetadata,
        mapping.people,
        content.speakerUserIds,
      ),
    });
    const review = JSON.stringify({ reason: "source_changed", incoming: content, incomingHistoricalMetadata: [entry] });
    reviewRequired++;
    reviewSourceKeys.push(mapping.sourceKey);
    if (review !== row.source_review_json) {
      guarded.push(row);
      statements.push(
        db
          .prepare("UPDATE event_agenda_contents SET source_review_json=?,updated_at=? WHERE id=? AND event_id=?")
          .bind(review, nowIso(), contentIds.get(mapping.sourceKey), eventId),
      );
    }
  }
  if (guarded.length) guards.push(historicalSourceGuard(db, eventId, guarded));
  return { statements, guards, reviewRequired, reviewSourceKeys };
}
