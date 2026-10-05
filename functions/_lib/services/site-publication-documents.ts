import { all } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { sessionPresentationPublicUrl } from "../../../assets/shared/session-presentation-public-url";
import {
  sessionHistoryMetadataSchema,
  sessionMaterialSchema,
  publicSessionMaterials,
  sessionMaterialReleaseIdentity,
  verifiedSessionMaterialLegacyDownload,
} from "../../../assets/shared/schemas/event-session-history";
import { legacyAgendaDownloadSchema } from "../../../assets/shared/schemas/event-agenda-legacy-fragments";
import type { LegacyAgendaDownload } from "../../../assets/shared/schemas/event-agenda-legacy-fragments";
import { assertPublicationMachineExtraction } from "./site-publication-machine-extraction";
import { publicationDocumentGrantId } from "../../../assets/shared/schemas/site-publication-documents";

export interface PublishedDocument {
  eventId: string;
  occurrenceId: string;
  materialId: string;
  versionId: string;
  digest: string;
  r2Key: string;
  fileSize: number;
  legacyDownload?: LegacyAgendaDownload;
  eventSlug?: string;
  fileName?: string;
  versionNumber?: number;
  grantId?: string;
  approvedAt?: string;
  approvalNonce?: string | null;
}
function documentIdentity(document: PublishedDocument) {
  return JSON.stringify([
    document.eventId,
    document.occurrenceId,
    document.materialId,
    document.versionId,
    document.digest,
    document.r2Key,
    document.fileSize,
    ...(document.legacyDownload ? [document.legacyDownload] : []),
  ]);
}
export interface VerifiedPublishedDocument extends PublishedDocument {
  objectEtag: string;
}
/** Resolve only explicitly released, authorized direct-session PDF references. */
async function resolveDocumentSelections(db: DatabaseLike, snapshot: SitePublicationSnapshot) {
  const requested = Object.entries(snapshot.eventAgendas ?? {}).flatMap(([eventSlug, agenda]) =>
    agenda.occurrences.flatMap((occurrence) =>
      (occurrence.history?.materials ?? [])
        .filter(
          (material) =>
            material.kind === "presentation" &&
            material.presentationSource === "session" &&
            material.presentationVersionId &&
            material.status === "approved" &&
            material.rightsConfirmed &&
            material.consentConfirmed &&
            material.validated &&
            material.approvedAt,
        )
        .map((material) => ({
          eventSlug,
          occurrenceId: occurrence.id,
          materialId: material.id,
          versionId: material.presentationVersionId!,
          url: material.url,
          material,
          legacyDownloads: occurrence.history?.legacyDownloads ?? [],
        })),
    ),
  );
  if (requested.length > 10000) throw new Error("Publication document inventory exceeds its bounded extraction limit");
  const result: {
    document: PublishedDocument;
    versionNumber: number;
    latestReviewId: string;
    metadataJson: string | null;
  }[] = [];
  for (let offset = 0; offset < requested.length; offset += 100) {
    const page = requested.slice(offset, offset + 100);
    const rows = await all<
      PublishedDocument & {
        eventSlug: string;
        versionNumber: number;
        latestReviewId: string;
        metadataJson: string | null;
      }
    >(
      db,
      `SELECT event.id AS eventId,event.slug AS eventSlug,version.occurrence_id AS occurrenceId,json_extract(requested.value,'$.materialId') AS materialId,version.id AS versionId,version.source_digest AS digest,version.r2_key AS r2Key,version.file_name AS fileName,version.file_size AS fileSize,version.version_number AS versionNumber,(SELECT id FROM session_presentation_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1) AS latestReviewId,history.metadata_json AS metadataJson FROM json_each(?) requested JOIN events event ON event.slug=json_extract(requested.value,'$.eventSlug') JOIN session_presentation_versions version ON version.event_id=event.id AND version.occurrence_id=json_extract(requested.value,'$.occurrenceId') AND version.id=json_extract(requested.value,'$.versionId') LEFT JOIN event_agenda_session_history history ON history.occurrence_id=version.occurrence_id WHERE version.deleted_at IS NULL AND version.mime_type='application/pdf' AND (SELECT status FROM session_presentation_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1)='approved'`,
      [JSON.stringify(page)],
    );
    if (rows.length !== page.length) throw new Error("Published PDF authority changed during extraction");
    for (const row of rows) {
      const reference = page.find(
        (item) =>
          item.materialId === row.materialId &&
          item.occurrenceId === row.occurrenceId &&
          item.eventSlug === row.eventSlug,
      );
      if (
        !reference ||
        reference.material.version !== row.versionNumber ||
        reference.url !==
          sessionPresentationPublicUrl({
            eventSlug: row.eventSlug,
            occurrenceId: row.occurrenceId,
            versionId: row.versionId,
            digest: row.digest,
          })
      )
        throw new Error("Published PDF URL does not identify its verified version");
      const { eventSlug, versionNumber, latestReviewId, metadataJson, ...stored } = row;
      const approvedAt = reference.material.approvedAt!;
      const approvalNonce = reference.material.approvalNonce ?? null;
      const document: PublishedDocument = { ...stored, eventSlug, versionNumber, approvedAt, approvalNonce };
      const current = sessionHistoryMetadataSchema.parse(JSON.parse(metadataJson ?? "{}"));
      const selected = current.materials.filter((material) => material.id === reference.materialId);
      if (
        selected.length !== 1 ||
        publicSessionMaterials(selected).length !== 1 ||
        sessionMaterialReleaseIdentity(selected[0]!) !==
          sessionMaterialReleaseIdentity(sessionMaterialSchema.parse(reference.material))
      )
        throw new Error("Published PDF selection changed during extraction");
      document.grantId = await publicationDocumentGrantId({
        ...document,
        eventSlug,
        approvedAt,
        approvalNonce,
      });
      if (reference.material.legacyDownloadUrl) {
        const receipt = verifiedSessionMaterialLegacyDownload(reference.material, current.legacyDownloads, {
          id: row.versionId,
          versionNumber,
          sourceDigest: row.digest,
          fileSize: row.fileSize,
          mimeType: "application/pdf",
        });
        const expected = reference.legacyDownloads.find((item) => item.url === reference.material.legacyDownloadUrl);
        if (!receipt || JSON.stringify(receipt) !== JSON.stringify(expected))
          throw new Error("Historical PDF receipt does not bind the selected owned version bytes");
        document.legacyDownload = receipt;
      }
      result.push({
        document,
        versionNumber,
        latestReviewId,
        metadataJson,
      });
    }
  }
  return result.sort((a, b) => documentIdentity(a.document).localeCompare(documentIdentity(b.document)));
}
export async function resolvePublishedDocuments(
  db: DatabaseLike,
  snapshot: SitePublicationSnapshot,
): Promise<PublishedDocument[]> {
  return (await resolveDocumentSelections(db, snapshot)).map(({ document }) => document);
}
export interface RetainedPublishedDocument {
  eventId: string;
  occurrenceId: string;
  materialId: string;
  versionId: string;
  digest: string;
  url: string;
  legacyDownload: LegacyAgendaDownload;
}
/** Retain immutable, previously activated byte provenance without granting PDF delivery. */
export async function resolveRetainedPublishedDocuments(db: DatabaseLike): Promise<RetainedPublishedDocument[]> {
  const rows = await all<{
    eventId: string;
    eventSlug: string;
    occurrenceId: string;
    materialId: string;
    versionId: string;
    digest: string;
    legacyJson: string;
    ownerCount: number;
    receiptCount: number;
    nativeDigest: string;
    nativeBytes: number;
    nativeMime: string;
  }>(
    db,
    `WITH proven AS (
    SELECT manifest.event_id AS eventId,manifest.occurrence_id AS occurrenceId,manifest.material_id AS materialId,
      manifest.version_id AS versionId,manifest.digest,manifest.legacy_download_json AS legacyJson,
      MAX(receipt.activated_at) AS activatedAt
    FROM site_publication_document_manifests manifest
    JOIN site_publication_activation_receipts receipt ON receipt.build_id=manifest.build_id AND receipt.snapshot_id=manifest.snapshot_id
    WHERE manifest.legacy_download_json IS NOT NULL
    GROUP BY manifest.event_id,manifest.occurrence_id,manifest.material_id,manifest.version_id,manifest.digest,manifest.legacy_download_json
  ), keyed AS (
    SELECT eventId,occurrenceId,materialId,versionId,digest,legacyJson,activatedAt,
      CASE WHEN json_valid(legacyJson) THEN COALESCE(json_extract(legacyJson,'$.url'),legacyJson) ELSE legacyJson END AS oldUrl FROM proven
  ), ownership AS (
    SELECT oldUrl,COUNT(DISTINCT json_array(eventId,occurrenceId,materialId)) AS ownerCount,
      COUNT(DISTINCT legacyJson) AS receiptCount FROM keyed GROUP BY oldUrl
  ), ranked AS (
    SELECT eventId,occurrenceId,materialId,versionId,digest,legacyJson,activatedAt,oldUrl,ROW_NUMBER() OVER(PARTITION BY oldUrl ORDER BY activatedAt DESC,versionId DESC) AS position FROM keyed
  ) SELECT ranked.eventId,event.slug AS eventSlug,ranked.occurrenceId,ranked.materialId,ranked.versionId,ranked.digest,
    ranked.legacyJson,ownership.ownerCount,ownership.receiptCount,version.source_digest AS nativeDigest,version.file_size AS nativeBytes,version.mime_type AS nativeMime
    FROM ranked JOIN ownership ON ownership.oldUrl=ranked.oldUrl JOIN events event ON event.id=ranked.eventId
    LEFT JOIN session_presentation_versions version ON version.id=ranked.versionId AND version.event_id=ranked.eventId AND version.occurrence_id=ranked.occurrenceId
    WHERE ranked.position=1 ORDER BY ranked.oldUrl LIMIT 1001`,
  );
  if (rows.length > 1000) throw new Error("Retained document routes exceed their bounded inventory");
  return rows.map(
    ({ eventSlug, legacyJson, ownerCount, receiptCount, nativeDigest, nativeBytes, nativeMime, ...document }) => {
      const receipt = legacyAgendaDownloadSchema.parse(JSON.parse(legacyJson));
      if (
        ownerCount !== 1 ||
        receiptCount !== 1 ||
        receipt.pdfDigest !== document.digest ||
        receipt.pdfBytes === null ||
        nativeDigest !== document.digest ||
        nativeBytes !== receipt.pdfBytes ||
        nativeMime !== "application/pdf"
      )
        throw new Error("Retained document provenance has conflicting owners or bytes");
      return {
        ...document,
        legacyDownload: receipt,
        url: sessionPresentationPublicUrl({
          eventSlug,
          occurrenceId: document.occurrenceId,
          versionId: document.versionId,
          digest: document.digest,
        }),
      };
    },
  );
}
/** Native extraction writes an immutable selection, activated solely by the existing build receipt. */
export async function recordPublishedDocuments(
  db: DatabaseLike,
  snapshot: SitePublicationSnapshot,
  documents: VerifiedPublishedDocument[],
  env: Record<string, string | undefined>,
) {
  const machine = await assertPublicationMachineExtraction(db, env);
  if (!machine) {
    if (documents.length && (env.CLOUDFLARE_ENV === "preview" || env.CLOUDFLARE_ENV === "production"))
      throw new Error("Published PDF manifests require the native publication coordinator");
    return;
  }
  if (snapshot.sourceSequence !== machine.sourceSequence) throw new Error("PUBLICATION_EXTRACTION_SOURCE_CHANGED");
  if (documents.length > 10000) throw new Error("Publication document inventory exceeds its bounded extraction limit");
  const selections = await resolveDocumentSelections(db, snapshot);
  const selected = selections.map(({ document }) => document);
  const normalized = documents.map((document) => ({
    ...document,
    grantId: selected.find(
      (item) =>
        item.eventId === document.eventId &&
        item.occurrenceId === document.occurrenceId &&
        item.materialId === document.materialId,
    )?.grantId,
  }));
  const claimed = documents.map(documentIdentity).sort();
  if (JSON.stringify(selected.map(documentIdentity).sort()) !== JSON.stringify(claimed))
    throw new Error("Published PDF selection does not match the approved snapshot");
  const statements = [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM site_publication_pipeline_fence fence JOIN site_publication_provider_attempts attempt ON attempt.id=fence.attempt_id JOIN site_publication_delivery_state state ON state.id=1 WHERE fence.id=1 AND attempt.id=? AND attempt.build_id=? AND attempt.phase='build_attested' AND fence.lease_token=attempt.lease_token AND state.desired_sequence=?`,
      bindings: [machine.attemptId, machine.buildId, machine.sourceSequence],
    }),
  ];
  for (let offset = 0; offset < selections.length; offset += 100) {
    const page = selections
      .slice(offset, offset + 100)
      .map(({ document, ...evidence }) => ({ ...document, ...evidence }));
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM session_presentation_versions version LEFT JOIN event_agenda_session_history history ON history.occurrence_id=version.occurrence_id
        WHERE version.id=json_extract(expected.value,'$.versionId') AND version.event_id=json_extract(expected.value,'$.eventId')
        AND version.occurrence_id=json_extract(expected.value,'$.occurrenceId') AND version.deleted_at IS NULL AND version.mime_type='application/pdf'
        AND version.version_number=json_extract(expected.value,'$.versionNumber') AND version.source_digest=json_extract(expected.value,'$.digest')
        AND version.file_size=json_extract(expected.value,'$.fileSize') AND version.r2_key=json_extract(expected.value,'$.r2Key')
        AND (SELECT id FROM session_presentation_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1)=json_extract(expected.value,'$.latestReviewId')
        AND (SELECT status FROM session_presentation_reviews WHERE version_id=version.id ORDER BY reviewed_at DESC,id DESC LIMIT 1)='approved'
        AND (json_extract(expected.value,'$.metadataJson') IS NULL OR history.metadata_json=json_extract(expected.value,'$.metadataJson'))))`,
        bindings: [JSON.stringify(page)],
      }),
    );
  }
  for (let offset = 0; offset < documents.length; offset += 100)
    statements.push(
      db
        .prepare(
          `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json,grant_id) SELECT ?,?,json_extract(value,'$.eventId'),json_extract(value,'$.occurrenceId'),json_extract(value,'$.materialId'),json_extract(value,'$.versionId'),json_extract(value,'$.digest'),json_extract(value,'$.objectEtag'),json_extract(value,'$.legacyDownload'),json_extract(value,'$.grantId') FROM json_each(?) WHERE 1 ON CONFLICT(build_id,event_id,occurrence_id,material_id) DO NOTHING`,
        )
        .bind(machine.buildId, snapshot.snapshotId, JSON.stringify(normalized.slice(offset, offset + 100))),
    );
  statements.push(
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM site_publication_document_manifests WHERE build_id=?)=? AND NOT EXISTS(SELECT 1 FROM site_publication_document_manifests WHERE build_id=? AND snapshot_id<>?)`,
      bindings: [machine.buildId, documents.length, machine.buildId, snapshot.snapshotId],
    }),
  );
  await db.batch(statements);
}
