import { all } from "../db/queries";
import type { DatabaseLike, StatementLike } from "../types";
import {
  publicationRepairAliasesSchema,
  publicationRepairAliasPaths,
  type PublicationRepairAlias,
} from "../../../assets/shared/schemas/site-publication-repair-aliases";
import { readHistoricalOccurrenceSources, historicalSourceGuard } from "./event-agenda/historical-mapping-import";
type RepairDocument = Pick<
  PublicationRepairAlias,
  "eventId" | "eventSlug" | "occurrenceId" | "materialId" | "versionId" | "digest"
> & { fileSize: number };

/** Use the existing imported-source reader and atomic source guard, never a second provenance query. */
export async function preparePublicationRepairAliases(
  db: DatabaseLike,
  documents: readonly RepairDocument[],
  input: unknown,
) {
  const requested = publicationRepairAliasesSchema.parse(input);
  const retained = requested.length ? await resolveRetainedPublicationRepairAliases(db) : [];
  const aliases = requested.filter((alias) => {
    const selected = documents.some(
      (document) =>
        document.eventId === alias.eventId &&
        document.eventSlug === alias.eventSlug &&
        document.occurrenceId === alias.occurrenceId &&
        document.materialId === alias.materialId &&
        document.versionId === alias.versionId &&
        document.digest === alias.digest &&
        document.fileSize === alias.bytes,
    );
    if (selected) return true;
    if (retained.some((previous) => JSON.stringify(previous) === JSON.stringify(alias))) return false;
    throw new Error("PUBLICATION_REPAIR_ALIAS_SOURCE_CHANGED");
  });
  const guards: StatementLike[] = [];
  for (const eventId of new Set(aliases.map((alias) => alias.eventId))) {
    const selected = aliases.filter((alias) => alias.eventId === eventId);
    const rows = await readHistoricalOccurrenceSources(
      db,
      eventId,
      selected.map((alias) => alias.occurrenceId),
    );
    for (const alias of selected) {
      const matches = documents.filter(
        (document) =>
          document.eventId === alias.eventId &&
          document.eventSlug === alias.eventSlug &&
          document.occurrenceId === alias.occurrenceId &&
          document.materialId === alias.materialId &&
          document.versionId === alias.versionId &&
          document.digest === alias.digest &&
          document.fileSize === alias.bytes,
      );
      const source = rows.find((row) => row.id === alias.occurrenceId);
      if (
        matches.length !== 1 ||
        !source ||
        source.import_mode !== "archive" ||
        source.source_key !== alias.sourceKey ||
        source.source_path !== alias.sourcePath ||
        source.source_digest !== alias.sourceDigest ||
        source.source_ref !== alias.sourceRef ||
        Date.parse(alias.reviewedAt) > Date.now()
      )
        throw new Error("PUBLICATION_REPAIR_ALIAS_SOURCE_CHANGED");
    }
    for (let offset = 0; offset < rows.length; offset += 100)
      guards.push(historicalSourceGuard(db, eventId, rows.slice(offset, offset + 100)));
  }
  return { aliases, guards };
}

/** Activated repair evidence survives withdrawal without creating a document delivery grant. */
export async function resolveRetainedPublicationRepairAliases(db: DatabaseLike): Promise<PublicationRepairAlias[]> {
  const rows = await all<{
    eventId: string;
    eventSlug: string;
    occurrenceId: string;
    materialId: string;
    versionId: string;
    digest: string;
    fileSize: number;
    mimeType: string;
    aliasesJson: string;
  }>(
    db,
    `SELECT manifest.event_id AS eventId,event.slug AS eventSlug,manifest.occurrence_id AS occurrenceId,
    manifest.material_id AS materialId,manifest.version_id AS versionId,manifest.digest,
    version.file_size AS fileSize,version.mime_type AS mimeType,manifest.repair_aliases_json AS aliasesJson
    FROM site_publication_document_manifests manifest
    JOIN site_publication_activation_receipts activation ON activation.build_id=manifest.build_id AND activation.snapshot_id=manifest.snapshot_id
    JOIN events event ON event.id=manifest.event_id
    JOIN session_presentation_versions version ON version.event_id=manifest.event_id AND version.occurrence_id=manifest.occurrence_id AND version.id=manifest.version_id AND version.source_digest=manifest.digest
    WHERE manifest.repair_aliases_json IS NOT NULL
    GROUP BY manifest.event_id,event.slug,manifest.occurrence_id,manifest.material_id,manifest.version_id,manifest.digest,manifest.repair_aliases_json
    ORDER BY manifest.event_id,manifest.occurrence_id,manifest.material_id LIMIT 1001`,
  );
  if (rows.length > 1000) throw new Error("Retained repair alias inventory exceeds its bounded extraction limit");
  const byOwner = new Map<string, PublicationRepairAlias>();
  const byPath = new Map<string, string>();
  for (const row of rows) {
    const aliases = publicationRepairAliasesSchema.parse(JSON.parse(row.aliasesJson) as unknown);
    if (aliases.length !== 1) throw new Error("Invalid activated repair alias owner");
    const alias = aliases[0]!;
    if (
      alias.eventId !== row.eventId ||
      alias.eventSlug !== row.eventSlug ||
      alias.occurrenceId !== row.occurrenceId ||
      alias.materialId !== row.materialId ||
      alias.versionId !== row.versionId ||
      alias.digest !== row.digest ||
      alias.bytes !== row.fileSize ||
      row.mimeType !== "application/pdf"
    )
      throw new Error("Activated repair alias does not bind its exact owned bytes");
    const owner = JSON.stringify([alias.eventId, alias.occurrenceId, alias.materialId]);
    const previous = byOwner.get(owner);
    if (previous && JSON.stringify(previous) !== JSON.stringify(alias))
      throw new Error("Activated repair alias evidence conflicts");
    byOwner.set(owner, alias);
    for (const path of publicationRepairAliasPaths(alias)) {
      const key = decodeURIComponent(path).toLowerCase();
      if (byPath.has(key) && byPath.get(key) !== owner)
        throw new Error("Activated repair aliases have multiple owners");
      byPath.set(key, owner);
    }
  }
  return [...byOwner.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
