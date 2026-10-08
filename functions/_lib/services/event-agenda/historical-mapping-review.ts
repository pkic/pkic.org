import { agendaContentSourceSnapshotSchema } from "../../../../assets/shared/schemas/event-agenda-source-snapshot";
import type { z } from "zod";
import { agendaContentFieldsSchema, agendaContentSchema } from "../../../../assets/shared/schemas/event-agenda-content";
import {
  historicalMetadataReviewIssues,
  historicalReviewIssueMessages,
  historicalReviewMetadataSchema,
  historicalRetainedSourceEvidenceSchema,
} from "../../../../assets/shared/schemas/event-agenda-historical-review";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { historicalSourceGuard, historicalSourceProvenance, readHistoricalSources } from "./historical-mapping-import";
import { prepareRepresentationEligibility } from "./representation-eligibility";

/** Accept a verified source mapping with its roster in the existing atomic content command. */
export async function prepareHistoricalMappingReview(
  db: DatabaseLike,
  eventId: string,
  contentId: string,
  review: NonNullable<z.infer<typeof agendaContentSchema>["review"]>,
  content: z.infer<typeof agendaContentFieldsSchema>,
  actorId: string,
) {
  const entries = review.incomingHistoricalMetadata ?? [];
  const statements: StatementLike[] = [];
  if (!entries.length) return statements;
  const roster = (value: z.infer<typeof agendaContentFieldsSchema>) =>
    JSON.stringify([...value.speakerUserIds].sort().map((userId) => [userId, value.speakerRoles[userId] ?? "speaker"]));
  if (!review.incoming || roster(content) !== roster(review.incoming))
    throw new AppError(
      422,
      "AGENDA_HISTORICAL_REVIEW_ROSTER_MISMATCH",
      "Accept the complete verified source roster with this historical mapping.",
    );
  if (
    entries.some((entry) =>
      entry.incomingMetadata.sourceDecisions.some(
        (decision) => decision.decision === "reviewed_title" && decision.resolvedValue !== content.title,
      ),
    )
  )
    throw new AppError(
      422,
      "AGENDA_HISTORICAL_REVIEW_TITLE_MISMATCH",
      "Use the verified historical title when accepting this source review.",
    );
  const rows = await readHistoricalSources(
    db,
    eventId,
    entries.map((entry) => entry.sourceKey),
  );
  if (rows.length !== entries.length || new Set(entries.map((entry) => entry.occurrenceId)).size !== entries.length)
    throw new AppError(
      409,
      "AGENDA_HISTORICAL_REVIEW_CHANGED",
      "The historical source changed. Prepare a new source review.",
    );
  statements.push(historicalSourceGuard(db, eventId, rows));
  const declared = [
    ...rows.flatMap((row) =>
      row.source_snapshot_json
        ? agendaContentSourceSnapshotSchema.parse(JSON.parse(row.source_snapshot_json)).retainedSourceEvidence
        : [],
    ),
    ...entries.flatMap((entry) => entry.retainedSourceEvidence),
  ];
  const retained = historicalRetainedSourceEvidenceSchema.safeParse([
    ...new Map(declared.map((source) => [JSON.stringify(source), source])).values(),
  ]);
  if (!retained.success)
    throw new AppError(
      422,
      "AGENDA_HISTORICAL_SOURCE_EVIDENCE_LIMIT",
      "Review this historical source in a manifest with at most three distinct retained source receipts.",
    );

  const references = [];
  for (const entry of entries) {
    const row = rows.find((item) => item.id === entry.occurrenceId && item.content_id === contentId);
    if (
      !row ||
      row.source_key !== entry.sourceKey ||
      (await sha256Hex(row.metadata_json ?? "")) !== entry.expectedHistoryDigest ||
      (await sha256Hex(JSON.stringify(historicalSourceProvenance(row)))) !== entry.expectedProvenanceDigest ||
      row.source_path !== entry.originalSource.sourcePath ||
      row.source_ref !== entry.originalSource.sourceRef ||
      row.source_digest !== entry.originalSource.sourceDigest ||
      JSON.stringify(
        agendaContentSchema.shape.review.parse(row.source_review_json ? JSON.parse(row.source_review_json) : null),
      ) !== JSON.stringify(review)
    )
      throw new AppError(
        409,
        "AGENDA_HISTORICAL_REVIEW_CHANGED",
        "The historical source changed. Prepare a new source review.",
      );
    const current = sessionHistoryMetadataSchema.parse(row.metadata_json ? JSON.parse(row.metadata_json) : {});
    if (JSON.stringify(historicalReviewMetadataSchema.parse(current)) !== JSON.stringify(entry.originalMetadata))
      throw new AppError(
        409,
        "AGENDA_HISTORICAL_REVIEW_CHANGED",
        "The historical evidence changed. Prepare a new source review.",
      );
    const incoming = entry.incomingMetadata;
    const retainLinks = <T>(
      original: readonly T[],
      next: readonly T[],
      key: (item: T) => string,
      enrichment?: (original: T, incoming: T) => boolean,
    ) => {
      const retained = new Map(original.map((item) => [key(item), item]));
      for (const item of next) {
        const old = retained.get(key(item));
        if (old && JSON.stringify(old) !== JSON.stringify(item) && !enrichment?.(old, item))
          throw new AppError(
            422,
            "AGENDA_HISTORICAL_LINK_CONFLICT",
            "Keep each original historical link and its authored source evidence unchanged.",
          );
        retained.set(key(item), item);
      }
      return [...retained.values()];
    };
    const issues = historicalMetadataReviewIssues(
      entry.originalMetadata,
      incoming,
      entry.people,
      content.speakerUserIds,
      entry.originalSource,
    );
    if (issues.length)
      throw new AppError(
        422,
        "AGENDA_HISTORICAL_MAPPING_REQUIRED",
        issues.map((issue) => historicalReviewIssueMessages[issue]).join(" "),
      );
    const history = sessionHistoryMetadataSchema.parse({
      ...current,
      archivalCredits: incoming.archivalCredits,
      sourceDecisions: incoming.sourceDecisions,
      archivalTiming: current.archivalTiming ?? incoming.archivalTiming,
      legacyPaths: [...new Set([...current.legacyPaths, ...incoming.legacyPaths])],
      legacyFragments: retainLinks(current.legacyFragments, incoming.legacyFragments, (fragment) => fragment.anchor),
      legacyDownloads: retainLinks(
        current.legacyDownloads,
        incoming.legacyDownloads,
        (download) => download.url,
        (original, next) =>
          original.pdfDigest === null &&
          original.pdfBytes === null &&
          next.pdfDigest !== null &&
          next.pdfBytes !== null &&
          JSON.stringify(original) === JSON.stringify({ ...next, pdfDigest: null, pdfBytes: null }),
      ),
      appearances: [
        ...current.appearances,
        ...incoming.appearances.filter(
          (appearance) => !current.appearances.some((approved) => approved.userId === appearance.userId),
        ),
      ],
    });
    references.push(
      ...history.appearances
        .filter((appearance) => content.speakerUserIds.includes(appearance.userId))
        .map((appearance) => ({
          userId: appearance.userId,
          actingIdentityId: appearance.actingIdentityId,
          at: row.start_at ?? current.archivalTiming?.startAt ?? incoming.archivalTiming?.startAt ?? null,
        })),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(occurrence_id) DO UPDATE SET metadata_json=excluded.metadata_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
        )
        .bind(row.id, JSON.stringify(history), actorId, nowIso()),
    );
  }
  statements.splice(1, 0, ...(await prepareRepresentationEligibility(db, references)));
  statements.push(
    db
      .prepare(
        "UPDATE event_agenda_contents SET source_snapshot_json=json_set(source_snapshot_json,'$.retainedSourceEvidence',json(?)) WHERE id=? AND event_id=?",
      )
      .bind(JSON.stringify(retained.data), contentId, eventId),
  );
  return statements;
}
