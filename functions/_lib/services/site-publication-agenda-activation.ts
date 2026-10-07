import { storedAgendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda-stored";
import { all } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { validateAgendaSchedule } from "./event-agenda/mutations";
import { preparePublicationCapacityGuard } from "./event-agenda/publication-capacity";
import {
  occurrenceRepresentationReferences,
  prepareRepresentationEligibility,
} from "./event-agenda/representation-eligibility";
import { preparePublicationParticipationGuard } from "./event-participation/publication-impact";

/** The approved schedule stays authoritative while live reservations and selected identities are rechecked. */
export async function prepareSiteAgendaActivationGuards(db: DatabaseLike): Promise<StatementLike[]> {
  const guards: StatementLike[] = [];
  let after = "";
  let count = 0;
  for (;;) {
    const page = await all<{ eventId: string; slug: string; revision: number; snapshotJson: string }>(
      db,
      `SELECT event.id AS eventId,event.slug,publication.revision,publication.snapshot_json AS snapshotJson
       FROM events event JOIN event_agenda_state state ON state.event_id=event.id
       JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision
       WHERE event.visibility='public' AND event.id>? ORDER BY event.id LIMIT 100`,
      [after],
    );
    if (!page.length) break;
    guards.push(
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(
          SELECT 1 FROM events event JOIN event_agenda_state state ON state.event_id=event.id
          JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision
          WHERE event.id=json_extract(expected.value,'$.eventId') AND event.slug=json_extract(expected.value,'$.slug') AND event.visibility='public'
          AND publication.revision=json_extract(expected.value,'$.revision') AND publication.snapshot_json=json_extract(expected.value,'$.snapshotJson')))`,
        bindings: [JSON.stringify(page)],
      }),
    );
    for (const row of page) {
      const snapshot = storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshotJson));
      if (
        snapshot.eventSlug !== row.slug ||
        snapshot.revision !== row.revision ||
        snapshot.publishedRevision !== row.revision
      )
        throw new Error("PUBLICATION_AGENDA_BASIS_INVALID");
      validateAgendaSchedule(snapshot, snapshot.occurrences);
      guards.push(
        ...(await prepareRepresentationEligibility(db, occurrenceRepresentationReferences(snapshot.occurrences))),
        preparePublicationCapacityGuard(db, snapshot, { eventId: row.eventId, revision: row.revision }),
        preparePublicationParticipationGuard(db, row.eventId, snapshot),
      );
    }
    count += page.length;
    after = page[page.length - 1]!.eventId;
  }
  guards.push(
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM events event JOIN event_agenda_state state ON state.event_id=event.id
        JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision
        WHERE event.visibility='public')=?`,
      bindings: [count],
    }),
  );
  return guards;
}
