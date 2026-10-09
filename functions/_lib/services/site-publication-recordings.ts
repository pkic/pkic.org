import { all } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { sessionRecordingPublicUrl } from "../../../assets/shared/session-recording-public-url";
import {
  sessionHistoryMetadataSchema,
  publicSessionMaterials,
  sessionMaterialReleaseIdentity,
} from "../../../assets/shared/schemas/event-session-history";
import {
  publicationRecordingAllowSchema,
  type PublicationRecordingAllow,
} from "../../../assets/shared/schemas/site-publication-recordings";
import { publicationDocumentGrantId } from "../../../assets/shared/schemas/site-publication-documents";
import { liveRecordingMaterialVersions, recordingEligibilityKey } from "./site-recording-material-eligibility";
import {
  assertPublicationMachineExtraction,
  preparePublicationMachineExtractionGuard,
} from "./site-publication-machine-extraction";

export type PublishedRecording = Omit<PublicationRecordingAllow, "version">;
function identity(recording: PublishedRecording) {
  return JSON.stringify(publicationRecordingAllowSchema.parse({ ...recording, version: 1 }));
}
async function resolveSelections(db: DatabaseLike, snapshot: SitePublicationSnapshot) {
  const requested = Object.entries(snapshot.eventAgendas ?? {}).flatMap(([eventSlug, agenda]) =>
    agenda.occurrences.flatMap((occurrence) =>
      publicSessionMaterials(occurrence.history?.materials ?? [])
        .filter((material) => material.kind === "recording" && material.recordingVersionId)
        .map((material) => ({ eventSlug, occurrenceId: occurrence.id, material })),
    ),
  );
  if (requested.length > 10000) throw new Error("Publication recording inventory exceeds its bounded extraction limit");
  const events = new Map<string, string>();
  const slugs = [...new Set(requested.map(({ eventSlug }) => eventSlug))];
  for (let offset = 0; offset < slugs.length; offset += 100) {
    const rows = await all<{ eventSlug: string; eventId: string }>(
      db,
      `SELECT event.slug AS eventSlug,event.id AS eventId FROM json_each(?) requested JOIN events event ON event.slug=requested.value`,
      [JSON.stringify(slugs.slice(offset, offset + 100))],
    );
    for (const row of rows) events.set(row.eventSlug, row.eventId);
  }
  const owned = requested.map((reference) => {
    const eventId = events.get(reference.eventSlug);
    if (!eventId) throw new Error("Published recording event no longer exists");
    return { ...reference, eventId };
  });
  const versions = await liveRecordingMaterialVersions(
    db,
    owned.map(({ eventId, material }) => ({ eventId, versionId: material.recordingVersionId! })),
  );
  const selections: { recording: PublishedRecording; metadataJson: string | null }[] = [];
  for (let offset = 0; offset < owned.length; offset += 100) {
    const page = owned.slice(offset, offset + 100);
    const rows = await all<{ eventId: string; occurrenceId: string; metadataJson: string | null }>(
      db,
      `SELECT occurrence.event_id AS eventId,occurrence.id AS occurrenceId,history.metadata_json AS metadataJson
       FROM json_each(?) requested JOIN event_agenda_occurrences occurrence
       ON occurrence.id=json_extract(requested.value,'$.occurrenceId') AND occurrence.event_id=json_extract(requested.value,'$.eventId')
       LEFT JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id`,
      [JSON.stringify(page)],
    );
    for (const reference of page) {
      const version = versions.get(recordingEligibilityKey(reference.eventId, reference.material.recordingVersionId!));
      const row = rows.find(
        (item) => item.eventId === reference.eventId && item.occurrenceId === reference.occurrenceId,
      );
      if (!version || !row || version.event_slug !== reference.eventSlug)
        throw new Error("Published recording authority changed during extraction");
      const current = sessionHistoryMetadataSchema.parse(JSON.parse(row.metadataJson ?? "{}"));
      const selected = current.materials.filter((material) => material.id === reference.material.id);
      if (
        selected.length !== 1 ||
        publicSessionMaterials(selected).length !== 1 ||
        sessionMaterialReleaseIdentity(selected[0]!) !== sessionMaterialReleaseIdentity(reference.material)
      )
        throw new Error("Published recording selection changed during extraction");
      const basis = {
        kind: "recording" as const,
        eventId: reference.eventId,
        eventSlug: reference.eventSlug,
        occurrenceId: reference.occurrenceId,
        materialId: reference.material.id,
        versionId: version.id,
        digest: version.digest,
        r2Key: version.r2_key,
        fileSize: version.file_size,
        mimeType: version.mime_type,
        objectEtag: version.object_etag,
        versionNumber: version.version_number,
        approvedAt: reference.material.approvedAt!,
        approvalNonce: reference.material.approvalNonce ?? null,
      };
      if (
        reference.material.version !== basis.versionNumber ||
        reference.material.url !== sessionRecordingPublicUrl(basis)
      )
        throw new Error("Published recording URL does not identify its owned version");
      const { version: _, ...recording } = publicationRecordingAllowSchema.parse({
        ...basis,
        version: 1,
        grantId: await publicationDocumentGrantId(basis),
      });
      selections.push({ recording, metadataJson: row.metadataJson });
    }
  }
  return selections.sort((left, right) => identity(left.recording).localeCompare(identity(right.recording)));
}
export async function resolvePublishedRecordings(
  db: DatabaseLike,
  snapshot: SitePublicationSnapshot,
): Promise<PublishedRecording[]> {
  return (await resolveSelections(db, snapshot)).map(({ recording }) => recording);
}
/** Byte verification precedes this atomic, exact owned-version manifest capture. */
export async function recordPublishedRecordings(
  db: DatabaseLike,
  snapshot: SitePublicationSnapshot,
  recordings: PublishedRecording[],
  env: Record<string, string | undefined>,
) {
  const machine = await assertPublicationMachineExtraction(db, env);
  if (!machine) {
    if (recordings.length) throw new Error("Published recordings require the attested native publication coordinator");
    return;
  }
  if (snapshot.sourceSequence !== machine.sourceSequence) throw new Error("PUBLICATION_EXTRACTION_SOURCE_CHANGED");
  const selections = await resolveSelections(db, snapshot);
  if (
    JSON.stringify(selections.map(({ recording }) => identity(recording)).sort()) !==
    JSON.stringify(recordings.map(identity).sort())
  )
    throw new Error("Published recording bytes do not match the approved snapshot");
  const statements = [preparePublicationMachineExtractionGuard(db, machine)];
  for (let offset = 0; offset < selections.length; offset += 100) {
    const page = selections
      .slice(offset, offset + 100)
      .map(({ recording, metadataJson }) => ({ ...recording, metadataJson }));
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
        SELECT 1 FROM event_recording_versions version JOIN event_recording_sources source ON source.id=version.source_id AND source.event_id=version.event_id
        JOIN event_recording_acquisitions acquisition ON acquisition.id=version.acquisition_id AND acquisition.event_id=version.event_id
          AND acquisition.source_id=version.source_id AND acquisition.completed_version_id=version.id AND acquisition.status='completed'
          AND acquisition.expected_metadata_revision=version.source_metadata_revision AND acquisition.completed_at IS NOT NULL
        JOIN event_agenda_occurrences occurrence ON occurrence.id=json_extract(expected.value,'$.occurrenceId') AND occurrence.event_id=version.event_id
        LEFT JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id
        WHERE version.id=json_extract(expected.value,'$.versionId') AND version.event_id=json_extract(expected.value,'$.eventId')
          AND version.deleted_at IS NULL AND source.disabled_at IS NULL
          AND version.version_number=json_extract(expected.value,'$.versionNumber') AND version.digest=json_extract(expected.value,'$.digest')
          AND version.file_size=json_extract(expected.value,'$.fileSize') AND version.mime_type=json_extract(expected.value,'$.mimeType')
          AND version.r2_key=json_extract(expected.value,'$.r2Key') AND version.object_etag=json_extract(expected.value,'$.objectEtag')
          AND history.metadata_json IS json_extract(expected.value,'$.metadataJson')))`,
        bindings: [JSON.stringify(page)],
      }),
      db
        .prepare(
          `INSERT INTO site_publication_recording_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,grant_id)
        SELECT ?,?,json_extract(value,'$.eventId'),json_extract(value,'$.occurrenceId'),json_extract(value,'$.materialId'),json_extract(value,'$.versionId'),
        json_extract(value,'$.digest'),json_extract(value,'$.objectEtag'),json_extract(value,'$.grantId') FROM json_each(?) WHERE 1
        ON CONFLICT(build_id,event_id,occurrence_id,material_id) DO NOTHING`,
        )
        .bind(machine.buildId, snapshot.snapshotId, JSON.stringify(page)),
    );
  }
  statements.push(
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM site_publication_recording_manifests WHERE build_id=?)=?
      AND NOT EXISTS(SELECT 1 FROM site_publication_recording_manifests WHERE build_id=? AND snapshot_id<>?)`,
      bindings: [machine.buildId, recordings.length, machine.buildId, snapshot.snapshotId],
    }),
  );
  await db.batch(statements);
}
