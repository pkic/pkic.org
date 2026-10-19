import type { AgendaOccurrenceFilterOptionsQuery } from "../../../../assets/shared/schemas/agenda-occurrence-filter-options";
import { listFilterOptionsResponseSchema } from "../../../../assets/shared/schemas/list-filter-options";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";
/** Event-owned tracks and assigned historical speakers are independent of the loaded session page. */
export async function listAgendaOccurrenceFilterOptions(
  db: DatabaseLike,
  eventId: string,
  query: AgendaOccurrenceFilterOptionsQuery,
) {
  const tracks = query.field === "track";
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [tracks ? "occurrence.track" : agendaSpeakerDisplayNameSql])
    : null;
  const { rows, total } = await queryPage<{ value: string; label: string }>(db, {
    sql: tracks
      ? `SELECT DISTINCT occurrence.track AS value,occurrence.track AS label FROM event_agenda_occurrences occurrence WHERE occurrence.event_id=? AND occurrence.track IS NOT NULL${search ? ` AND ${search.sql}` : ""}`
      : `SELECT DISTINCT user.id AS value,${agendaSpeakerDisplayNameSql} AS label
      FROM event_agenda_occurrences occurrence
      JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id
      JOIN users user ON user.id=speaker.user_id
      WHERE occurrence.event_id=?${search ? ` AND ${search.sql}` : ""}`,
    bindings: [eventId, ...(search?.bindings ?? [])],
    orderBy: resolveMappedOrderBy(query.sort, { value: "value" }, "value ASC", "value ASC"),
    limit: query.limit,
    offset: query.offset,
  });
  return listFilterOptionsResponseSchema.parse({
    options: rows,
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
