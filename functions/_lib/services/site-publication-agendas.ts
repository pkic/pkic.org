/**
 * The approved agendas of public events as the static site publishes them.
 * The publication snapshot pages through every one; a person's own profile
 * reads only the agendas that credit them. Both project the same way.
 */
import { all } from "../db/queries";
import type { CountryCode } from "../../../assets/shared/countries";
import type { DatabaseLike } from "../types";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import { storedAgendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda-stored";
import { publicAgendaProjection } from "./event-agenda/public-projection";
import { withAgendaSpeakerOrganizations } from "./event-agenda/speaker-organizations";
import { withSpeakerProfileSlugs } from "./people/profile-addresses";
import { withSessionPageSlugs } from "./event-agenda/session-page-slugs";
import { projectLiveAgendaMaterialBatch } from "./site-agenda-material-eligibility";

export interface PublishedAgendaRow {
  event_id: string;
  slug: string;
  base_path: string | null;
  visibility: string;
  city: string | null;
  country: CountryCode | null;
  snapshot_json: string;
}

const PUBLISHED_AGENDA_SQL = `SELECT e.id AS event_id,e.slug, e.base_path, e.visibility, e.city, e.country, p.snapshot_json FROM event_agenda_publications p
       JOIN event_agenda_state s ON s.event_id = p.event_id AND s.published_revision = p.revision
       JOIN events e ON e.id = p.event_id WHERE e.visibility = 'public'`;

/** One page of published agendas in event slug order. */
export function readPublishedAgendaPage(db: DatabaseLike, after: string) {
  return all<PublishedAgendaRow>(db, `${PUBLISHED_AGENDA_SQL} AND e.slug > ? ORDER BY e.slug LIMIT 100`, [after]);
}

/** The published agendas with an approved appearance by this person, at most the 100 most recent events by slug. */
export function readPublishedAgendasCrediting(db: DatabaseLike, userId: string) {
  return all<PublishedAgendaRow>(
    db,
    `${PUBLISHED_AGENDA_SQL} AND EXISTS (
       SELECT 1 FROM json_each(p.snapshot_json, '$.occurrences') occurrence,
                     json_each(occurrence.value, '$.history.appearances') appearance
        WHERE json_extract(appearance.value, '$.userId') = ?)
     ORDER BY e.slug LIMIT 100`,
    [userId],
  );
}

/** Each row's approved revision with live materials, organizations and page addresses, as the site renders it. */
export async function projectPublishedAgendas(db: DatabaseLike, rows: readonly PublishedAgendaRow[]) {
  const projected = await projectLiveAgendaMaterialBatch(
    db,
    rows.map((row) => ({
      eventId: row.event_id,
      snapshot: storedAgendaSnapshotSchema.parse(JSON.parse(row.snapshot_json)),
    })),
  );
  const result: Array<{ row: PublishedAgendaRow; approved: AgendaSnapshot; publicAgenda: AgendaSnapshot }> = [];
  for (const [index, row] of rows.entries()) {
    const approved = projected[index]!;
    // Organization branding is live; older approvals without it gain the same projection.
    const publicAgenda = await withSessionPageSlugs(
      db,
      row.event_id,
      await withSpeakerProfileSlugs(
        db,
        await withAgendaSpeakerOrganizations(
          db,
          publicAgendaProjection(approved, {
            basePath: row.base_path,
            visibility: row.visibility,
            city: row.city,
            country: row.country,
          }),
        ),
      ),
    );
    result.push({ row, approved, publicAgenda });
  }
  return result;
}
