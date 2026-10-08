import { all } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";
import { publicationDocumentEffectsSchema } from "../../../assets/shared/schemas/site-publication-documents";

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
  const rows = await all(
    db,
    `SELECT DISTINCT event.slug AS eventSlug,manifest.event_id AS eventId,
    manifest.occurrence_id AS occurrenceId,manifest.material_id AS materialId,manifest.version_id AS versionId,
    manifest.digest,manifest.grant_id AS grantId FROM site_publication_document_manifests manifest
    JOIN events event ON event.id=manifest.event_id WHERE ${where} ORDER BY manifest.grant_id LIMIT 1001`,
    bindings,
  );
  const effects = publicationDocumentEffectsSchema.parse(rows);
  const guard = prepareAuthorizationGuard(db, {
    sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM site_publication_document_manifests manifest
      WHERE ${where} AND manifest.grant_id NOT IN(SELECT json_extract(value,'$.grantId') FROM json_each(?)))`,
    bindings: [...bindings, JSON.stringify(effects)],
  });
  return { effects, guard };
}
