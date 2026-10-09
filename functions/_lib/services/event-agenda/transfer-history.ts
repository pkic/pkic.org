import type { z } from "zod";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
import type { transferPrepareSchema } from "../../../../assets/shared/schemas/event-agenda-transfer";
import { parseSessionRecordingPublicUrl } from "../../../../assets/shared/session-recording-public-url";
import { agendaTransferModePolicy } from "../../../../assets/shared/event-agenda-transfer";
import { historicalReviewMetadataSchema } from "../../../../assets/shared/schemas/event-agenda-historical-review";
import type { HistoricalMappingCandidate } from "./historical-mapping-import";
type Input = z.infer<typeof transferPrepareSchema>;
export function legacyFragmentTransferRoomRef(input: Input, fragment: { roomRef: string; roomId: string | null }) {
  return input.document.rooms.some((room) => room.ref === fragment.roomRef) ? fragment.roomRef : fragment.roomId;
}
export function transferredLegacyFragmentRoomId(input: Input, fragment: { roomRef: string; roomId: string | null }) {
  const ref = legacyFragmentTransferRoomRef(input, fragment);
  if (!ref) return null;
  return input.resolutions.rooms[ref] ?? input.document.rooms.find((room) => room.ref === ref)?.canonicalRoomId ?? null;
}
/** Reusable content is retained, but importing cannot grant new material release authority. */
export function transferredSessionHistory(input: Input, row: Input["document"]["occurrences"][number]) {
  const policy = agendaTransferModePolicy[input.mode],
    copy = !policy.retainsSource;
  const materials = (row.archive?.materials ?? []).flatMap((material) => {
    // Uploaded versions belong to their original occurrence. A new import keeps only a reusable URL candidate.
    const media = row.media.find((item) => item.kind === material.kind);
    const url =
      (parseSessionRecordingPublicUrl(material.url) ? "" : material.url) ||
      (media && (input.resolutions.media[media.authoredReference] ?? media.publicUrl));
    if (!url || parseSessionRecordingPublicUrl(url)) return [];
    return [
      {
        ...material,
        id: copy ? crypto.randomUUID() : material.id,
        url,
        presentationVersionId: null,
        recordingVersionId: null,
        legacyDownloadUrl: null,
        presentationSource: "proposal" as const,
        rightsConfirmed: false,
        consentConfirmed: false,
        validated: false,
        status: material.status === "withdrawn" ? ("withdrawn" as const) : ("draft" as const),
        approvedAt: null,
        approvalNonce: null,
      },
    ];
  });
  for (const kind of ["presentation", "recording"] as const) {
    const media = row.media.find((item) => item.kind === kind);
    const url = media
      ? (input.resolutions.media[media.authoredReference] ?? media.publicUrl)
      : kind === "presentation"
        ? row.fields.presentationUrl
        : row.fields.recordingUrl;
    if (
      !url ||
      parseSessionRecordingPublicUrl(url) ||
      materials.some((material) => material.kind === kind && material.url === url)
    )
      continue;
    materials.push({
      id: crypto.randomUUID(),
      kind,
      title: `${row.fields.title} — ${kind}`.slice(0, 300),
      url,
      presentationVersionId: null,
      recordingVersionId: null,
      legacyDownloadUrl: null,
      presentationSource: "proposal",
      version: 1,
      rightsConfirmed: false,
      consentConfirmed: false,
      validated: false,
      status: "draft",
      approvedAt: null,
      approvalNonce: null,
    });
  }
  if (!row.archive && !materials.length) return null;
  return sessionHistoryMetadataSchema.parse({
    ...(copy ? {} : row.archive),
    ...(!copy && row.archive
      ? {
          legacyFragments: row.archive.legacyFragments.map((fragment) => ({
            ...fragment,
            roomId: transferredLegacyFragmentRoomId(input, fragment),
          })),
        }
      : {}),
    // A current agenda keeps approved appearances but never archival attribution.
    ...(policy.attribution === "canonical" ? { archivalCredits: [], archivalTiming: null, sourceDecisions: [] } : {}),
    ...(copy
      ? {
          appearances: [],
          archivalCredits: [],
          archivalTiming: null,
          sourceDecisions: [],
          proposalRepresentations: [],
          legacyPaths: [],
          legacyFragments: [],
          legacyDownloads: [],
          sessionSlug: null,
          prerequisites: row.archive?.prerequisites ?? "",
        }
      : {}),
    materials,
  });
}
/** Source-retaining imports reconcile appearances and history against the stored source on replay. */
export function historicalMappingCandidates(input: Input): HistoricalMappingCandidate[] {
  if (!agendaTransferModePolicy[input.mode].retainsSource) return [];
  return input.document.occurrences
    .filter((row) => !["skip", "retain_local"].includes(input.resolutions.rows[row.ref] ?? ""))
    .map((row) => ({
      sourceKey: row.sourceKey,
      sourcePath: row.sourcePath,
      sourceDigest: row.sourceDigest ?? input.document.source.sourceDigest,
      sourceRef: row.ref,
      retainedSourceEvidence: row.retainedSourceEvidence,
      incomingMetadata: historicalReviewMetadataSchema.parse(transferredSessionHistory(input, row) ?? {}),
      people: row.personRefs.map((ref) => {
        const person = input.document.people.find((item) => item.ref === ref)!,
          resolved = input.resolutions.people[ref];
        return {
          sourceRef: ref,
          userId: resolved?.userId ?? person?.canonicalUserId ?? null,
          actingIdentityId: resolved ? resolved.actingIdentityId : (person?.actingIdentityId ?? null),
        };
      }),
    }));
}
