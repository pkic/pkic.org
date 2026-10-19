import { z } from "zod";
import {
  meetingFormatCatalogQuerySchema,
  meetingAgendaItemsSchema,
  meetingAgendaSchema,
} from "../../../../assets/shared/schemas/meeting-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  buildLiveAccessibleGroupResourceIdsCte,
  liveGroupResourceContextAccess,
  type GroupResourceViewer,
} from "../resource-grants";
import { first, all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
export async function listMeetingFormats(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  query: z.infer<typeof meetingFormatCatalogQuerySchema>,
) {
  const access = buildLiveAccessibleGroupResourceIdsCte(
    "event",
    groupId,
    liveGroupResourceContextAccess(viewer, groupId),
    "manage",
  );
  const source = `FROM event_meeting_agenda_formats format JOIN event_series series ON series.id=format.series_id JOIN events event ON event.id=series.event_id JOIN accessible_resource accessible ON accessible.resource_id=event.id WHERE INSTR(LOWER(format.name||' '||event.name),LOWER(?))>0`;
  const values = [...access.bindings, query.q ?? ""];
  const total = await first<{ total: number }>(db, `WITH ${access.sql} SELECT COUNT(*) AS total ${source}`, values);
  const rows = await all<{
    series_id: string;
    version: number;
    name: string;
    event_name: string;
    items_json: string;
    created_at: string;
  }>(
    db,
    `WITH ${access.sql} SELECT format.series_id,format.version,format.name,event.name AS event_name,format.items_json,format.created_at ${source} ORDER BY format.name ${query.sort?.startsWith("-") ? "DESC" : "ASC"},format.series_id ASC,format.version DESC LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return {
    formats: rows.map((row) => ({
      seriesId: row.series_id,
      version: row.version,
      name: row.name,
      eventName: row.event_name,
      items: meetingAgendaItemsSchema.parse(JSON.parse(row.items_json)),
      createdAt: row.created_at,
    })),
    page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, rows.length),
  };
}
export async function getPublishedMeetingAgenda(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  seriesId: string,
  occurrenceId: string,
) {
  const access = buildLiveAccessibleGroupResourceIdsCte(
    "event",
    groupId,
    liveGroupResourceContextAccess(viewer, groupId),
    "view",
  );
  const row = await first<{
    revision: number;
    format_version: number;
    name: string;
    items_json: string;
    exception: number;
    published_at: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
  }>(
    db,
    `WITH ${access.sql} SELECT agenda.revision,agenda.format_version,agenda.name,agenda.items_json,agenda.exception,agenda.published_at,occurrence.starts_at,occurrence.ends_at,series.timezone FROM event_meeting_occurrence_agendas agenda JOIN event_occurrences occurrence ON occurrence.id=agenda.occurrence_id JOIN event_series series ON series.id=occurrence.series_id JOIN accessible_resource accessible ON accessible.resource_id=series.event_id WHERE agenda.series_id=? AND agenda.occurrence_id=? AND agenda.published_at IS NOT NULL AND series.active=1`,
    [...access.bindings, seriesId, occurrenceId],
  );
  return {
    agenda: row
      ? meetingAgendaSchema.parse({
          seriesId,
          occurrenceId,
          revision: row.revision,
          writeRevision: 0,
          formatVersion: row.format_version,
          sourceFormatVersion: row.format_version,
          name: row.name,
          items: JSON.parse(row.items_json),
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          timezone: row.timezone,
          exception: row.exception === 1,
          publishedAt: row.published_at,
        })
      : null,
  };
}
