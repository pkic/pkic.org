import { all } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import {
  publicationDocumentEffectsSchema,
  type PublicationDocumentEffect,
} from "../../../assets/shared/schemas/site-publication-documents";

/** Capture recorded selections, including builds not yet activated, inside the existing mutation boundary. */
export async function preparePublicationDocumentEffects(
  db: DatabaseLike,
  input: {
    eventId: string;
    occurrenceId: string;
    materialIds?: string[];
    versionId?: string;
  },
) {
  const where = `manifest.event_id=? AND manifest.occurrence_id=? AND manifest.grant_id IS NOT NULL
    AND (? IS NULL OR manifest.version_id=?)
    AND (? IS NULL OR manifest.material_id IN(SELECT value FROM json_each(?)))`;
  const materialIds = input.materialIds ? JSON.stringify(input.materialIds) : null;
  const bindings = [
    input.eventId,
    input.occurrenceId,
    input.versionId ?? null,
    input.versionId ?? null,
    materialIds,
    materialIds,
  ];
  const sources = [
    { table: "site_publication_document_manifests", kind: null },
    { table: "site_publication_recording_manifests", kind: "recording" },
  ] as const;
  const rows = await all<Omit<PublicationDocumentEffect, "kind"> & { kind: "recording" | null }>(
    db,
    `SELECT DISTINCT eventSlug,eventId,occurrenceId,materialId,versionId,digest,grantId,kind FROM (
      ${sources
        .map(
          ({ table, kind }) => `SELECT event.slug AS eventSlug,manifest.event_id AS eventId,
        manifest.occurrence_id AS occurrenceId,manifest.material_id AS materialId,manifest.version_id AS versionId,
        manifest.digest,manifest.grant_id AS grantId,${kind ? "'recording'" : "NULL"} AS kind
        FROM ${table} manifest JOIN events event ON event.id=manifest.event_id WHERE ${where}`,
        )
        .join(" UNION ALL ")}
      ) ORDER BY grantId LIMIT 1001`,
    [...bindings, ...bindings],
  );
  const effects = publicationDocumentEffectsSchema.parse(
    rows.map(({ kind, ...row }) => (kind ? { ...row, kind } : row)),
  );
  const guard = prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE ${sources
      .map(
        ({ table }) => `NOT EXISTS(SELECT 1 FROM ${table} manifest
      WHERE ${where} AND manifest.grant_id NOT IN(SELECT json_extract(value,'$.grantId') FROM json_each(?)))`,
      )
      .join(" AND ")}`,
    bindings: sources.flatMap(() => [...bindings, JSON.stringify(effects)]),
  });
  return { effects, guard };
}
