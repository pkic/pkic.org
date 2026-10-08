import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { sessionHistoryMetadataSchema } from "./event-session-history";

/** Only historical attribution moves through source review; material approvals remain occurrence-owned. */
export const historicalReviewMetadataSchema = sessionHistoryMetadataSchema.pick({
  appearances: true,
  archivalCredits: true,
  archivalTiming: true,
  sourceDecisions: true,
  legacyPaths: true,
  legacyFragments: true,
  legacyDownloads: true,
});
export const historicalReviewSourceSchema = z.object({
  sourcePath: z.string().min(1).max(1000),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRef: z.string().min(1).max(300),
});
/** Portable manifests retain declared source tuples without rewriting authored evidence. */
export const historicalRetainedSourceEvidenceSchema = z
  .array(historicalReviewSourceSchema)
  .max(3)
  .refine(
    (sources) => new Set(sources.map((source) => JSON.stringify(source))).size === sources.length,
    "Retain each source receipt once.",
  )
  .default([]);
export const historicalReviewIssueMessages = {
  archival_credit_unmapped: "Map each authored credit to a canonical person and approved representation.",
  title_unresolved: "Verify the missing historical title before accepting this review.",
  credit_unresolved: "Verify each missing historical credit before accepting this review.",
  appearance_missing: "Approve the historical representation for every mapped person.",
  approved_appearance_conflict: "Keep each existing approved appearance and its canonical person unchanged.",
  source_mapping_incomplete: "Resolve every original source reference through an explicit verified mapping.",
} as const;
export const historicalReviewIssueSchema = z.enum([
  "archival_credit_unmapped",
  "title_unresolved",
  "credit_unresolved",
  "appearance_missing",
  "approved_appearance_conflict",
  "source_mapping_incomplete",
]);
export const historicalReviewPersonSchema = z.object({
  sourceRef: z.string().min(1).max(300),
  userId: databaseIdSchema.nullable(),
  actingIdentityId: databaseIdSchema.nullable(),
});
export const agendaHistoricalMetadataReviewSchema = historicalReviewSourceSchema.extend({
  occurrenceId: databaseIdSchema,
  sourceKey: z.string().min(1).max(300),
  originalSource: historicalReviewSourceSchema,
  retainedSourceEvidence: historicalRetainedSourceEvidenceSchema,
  expectedHistoryDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedProvenanceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  originalMetadata: historicalReviewMetadataSchema,
  incomingMetadata: historicalReviewMetadataSchema,
  people: z.array(historicalReviewPersonSchema).max(30),
  reviewIssues: z.array(historicalReviewIssueSchema).max(6),
});
export type AgendaHistoricalMetadataReview = z.infer<typeof agendaHistoricalMetadataReviewSchema>;
export type HistoricalReviewMetadata = z.infer<typeof historicalReviewMetadataSchema>;
export type HistoricalReviewPerson = z.infer<typeof historicalReviewPersonSchema>;

/** The transport exposes the same blockers that the atomic acceptance boundary checks again. */
export function historicalMetadataReviewIssues(
  original: HistoricalReviewMetadata,
  incoming: HistoricalReviewMetadata,
  people: readonly HistoricalReviewPerson[],
  speakerUserIds: readonly string[],
  verifiedSource?: z.infer<typeof historicalReviewSourceSchema>,
) {
  const retainedSourceFacts =
    verifiedSource !== undefined &&
    original.sourceDecisions.length > 0 &&
    original.sourceDecisions.every(
      (decision) =>
        decision.sourcePath === verifiedSource.sourcePath && decision.sourceDigest === verifiedSource.sourceDigest,
    ) &&
    incoming.sourceDecisions.every(
      (decision) =>
        decision.sourcePath === verifiedSource.sourcePath &&
        decision.sourceDigest === verifiedSource.sourceDigest &&
        decision.sourceLocator === verifiedSource.sourceRef,
    ) &&
    JSON.stringify({
      ...original,
      sourceDecisions: original.sourceDecisions.map((decision) => ({
        ...decision,
        sourceLocator: verifiedSource.sourceRef,
      })),
    }) === JSON.stringify(incoming);
  const issues = new Set<z.infer<typeof historicalReviewIssueSchema>>();
  if (!retainedSourceFacts && incoming.archivalCredits.length) issues.add("archival_credit_unmapped");
  if (!retainedSourceFacts && incoming.sourceDecisions.some((item) => item.decision === "title_not_recorded"))
    issues.add("title_unresolved");
  if (!retainedSourceFacts && incoming.sourceDecisions.some((item) => item.decision === "credit_not_recorded"))
    issues.add("credit_unresolved");
  if (
    speakerUserIds.some(
      (id) =>
        !incoming.appearances.some((item) => item.userId === id) &&
        !original.appearances.some((item) => item.userId === id),
    )
  )
    issues.add("appearance_missing");
  if (
    original.appearances.some(
      (item) =>
        !speakerUserIds.includes(item.userId) ||
        incoming.appearances.some(
          (next) => next.userId === item.userId && JSON.stringify(next) !== JSON.stringify(item),
        ),
    )
  )
    issues.add("approved_appearance_conflict");
  if (retainedSourceFacts) return [...issues];
  const mapped = (ref: string) =>
    people.some(
      (person) =>
        person.sourceRef === ref &&
        person.userId !== null &&
        speakerUserIds.includes(person.userId) &&
        incoming.appearances.some(
          (appearance) =>
            appearance.userId === person.userId && appearance.actingIdentityId === person.actingIdentityId,
        ),
    );
  if (original.archivalCredits.some((item) => !mapped(item.sourceRef))) issues.add("source_mapping_incomplete");
  for (const old of original.sourceDecisions) {
    const next = incoming.sourceDecisions.find(
      (item) =>
        item.kind === old.kind && item.sourceLocator === old.sourceLocator && item.authoredValue === old.authoredValue,
    );
    if (old.decision === "title_not_recorded" && next?.decision !== "reviewed_title") issues.add("title_unresolved");
    if (
      old.decision === "credit_not_recorded" &&
      (next?.decision !== "reviewed_credit" || !next.resolvedValue || !mapped(next.resolvedValue))
    )
      issues.add("credit_unresolved");
    if (old.decision === "retain_source_credit" && old.resolvedValue && !mapped(old.resolvedValue))
      issues.add("source_mapping_incomplete");
  }
  return [...issues];
}
