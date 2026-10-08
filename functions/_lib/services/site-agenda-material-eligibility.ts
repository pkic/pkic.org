import { sessionPresentationPublicUrl } from "../../../assets/shared/session-presentation-public-url";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import {
  publicSessionMaterials,
  publicSessionMediaUrls,
  sessionHistoryMetadataSchema,
  sessionMaterialReleaseIdentity,
} from "../../../assets/shared/schemas/event-session-history";
interface AgendaMaterialSource {
  eventId: string;
  snapshot: AgendaSnapshot;
}
const key = (eventId: string, id: string) => `${eventId}\0${id}`;
const versionKey = (eventId: string, id: string, source: string, occurrenceId: string) =>
  `${key(eventId, id)}\0${source}\0${source === "session" ? occurrenceId : ""}`;

/** Page-wide authorized extraction rechecks revocable authority without changing immutable historical approval. */
export async function projectLiveAgendaMaterialBatch(
  db: DatabaseLike,
  entries: AgendaMaterialSource[],
): Promise<AgendaSnapshot[]> {
  const occurrencePairs = new Map<string, { eventId: string; id: string }>();
  const versionPairs = new Map<string, { eventId: string; id: string; source: string; occurrenceId: string }>();
  for (const { eventId, snapshot } of entries)
    for (const item of snapshot.occurrences) {
      if (item.history?.materials.length) occurrencePairs.set(key(eventId, item.id), { eventId, id: item.id });
      for (const material of item.history?.materials ?? [])
        if (material.presentationVersionId)
          versionPairs.set(
            versionKey(eventId, material.presentationVersionId, material.presentationSource ?? "proposal", item.id),
            {
              eventId,
              id: material.presentationVersionId,
              source: material.presentationSource ?? "proposal",
              occurrenceId: item.id,
            },
          );
    }
  const currentReleases = new Map<string, Set<string>>();
  const occurrences = [...occurrencePairs.values()];
  for (let offset = 0; offset < occurrences.length; offset += 100) {
    const rows = await all<{ event_id: string; occurrence_id: string; metadata_json: string }>(
      db,
      `SELECT occurrence.event_id,occurrence.id AS occurrence_id,history.metadata_json FROM json_each(?) requested JOIN event_agenda_occurrences occurrence ON occurrence.id=json_extract(requested.value,'$.id') AND occurrence.event_id=json_extract(requested.value,'$.eventId') JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id`,
      [JSON.stringify(occurrences.slice(offset, offset + 100))],
    );
    for (const row of rows) {
      const current = sessionHistoryMetadataSchema.parse(JSON.parse(row.metadata_json));
      currentReleases.set(
        key(row.event_id, row.occurrence_id),
        new Set(publicSessionMaterials(current.materials).map(sessionMaterialReleaseIdentity)),
      );
    }
  }
  const eligible = new Set<string>();
  const publicUrls = new Map<string, string>();
  const versions = [...versionPairs.values()];
  for (let offset = 0; offset < versions.length; offset += 100) {
    const rows = await all<{
      event_id: string;
      id: string;
      source: string;
      occurrence_id: string;
      event_slug: string | null;
      digest: string | null;
    }>(
      db,
      `SELECT proposal.event_id,version.id,'proposal' AS source,'' AS occurrence_id,NULL AS event_slug,NULL AS digest FROM json_each(?) requested JOIN presentation_versions version ON version.id=json_extract(requested.value,'$.id') JOIN session_proposals proposal ON proposal.id=version.proposal_id AND proposal.event_id=json_extract(requested.value,'$.eventId') WHERE COALESCE(json_extract(requested.value,'$.source'),'proposal')='proposal' AND proposal.deleted_at IS NULL AND proposal.status='accepted' AND version.deleted_at IS NULL AND (SELECT review.status FROM presentation_version_reviews review WHERE review.version_id=version.id ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1)='approved' UNION ALL SELECT version.event_id,version.id,'session' AS source,version.occurrence_id,(SELECT slug FROM events WHERE id=version.event_id) AS event_slug,version.source_digest AS digest FROM json_each(?) requested JOIN session_presentation_versions version ON version.id=json_extract(requested.value,'$.id') AND version.event_id=json_extract(requested.value,'$.eventId') AND version.occurrence_id=json_extract(requested.value,'$.occurrenceId') WHERE json_extract(requested.value,'$.source')='session' AND version.deleted_at IS NULL AND version.mime_type='application/pdf' AND (SELECT review.status FROM session_presentation_reviews review WHERE review.version_id=version.id ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1)='approved'`,
      [JSON.stringify(versions.slice(offset, offset + 100)), JSON.stringify(versions.slice(offset, offset + 100))],
    );
    for (const row of rows) {
      const identity = versionKey(row.event_id, row.id, row.source, row.occurrence_id);
      eligible.add(identity);
      if (row.source === "session" && row.event_slug && row.digest)
        publicUrls.set(
          identity,
          sessionPresentationPublicUrl({
            eventSlug: row.event_slug,
            occurrenceId: row.occurrence_id,
            versionId: row.id,
            digest: row.digest,
          }),
        );
    }
  }
  return entries.map(({ eventId, snapshot }) => ({
    ...snapshot,
    occurrences: snapshot.occurrences.map((item) => {
      if (!item.history) return { ...item, ...publicSessionMediaUrls([]) };
      const materials = publicSessionMaterials(item.history.materials)
        .filter(
          (material) =>
            currentReleases.get(key(eventId, item.id))?.has(sessionMaterialReleaseIdentity(material)) &&
            (!material.presentationVersionId ||
              eligible.has(
                versionKey(eventId, material.presentationVersionId, material.presentationSource ?? "proposal", item.id),
              )),
        )
        .map((material) => ({
          ...material,
          url: material.presentationVersionId
            ? (publicUrls.get(
                versionKey(eventId, material.presentationVersionId, material.presentationSource ?? "proposal", item.id),
              ) ?? material.url)
            : material.url,
        }));
      return {
        ...item,
        ...publicSessionMediaUrls(materials),
        history: { ...item.history, materials },
      };
    }),
  }));
}
export async function projectLiveAgendaMaterials(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
): Promise<AgendaSnapshot> {
  return (await projectLiveAgendaMaterialBatch(db, [{ eventId, snapshot }]))[0]!;
}
