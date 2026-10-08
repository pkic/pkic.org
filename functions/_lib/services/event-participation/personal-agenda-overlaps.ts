import { intervalsOverlap } from "../../../../assets/shared/event-agenda-policy";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
interface OverlapRow {
  current_id: string;
  current_start: string;
  current_end: string;
  id: string;
  title: string;
  status: string;
  start_at: string;
  end_at: string;
  total: number;
}
/** Only requested page IDs receive bounded summaries; the server retains population-wide overlap detection. */
export async function personalAgendaOverlaps(db: DatabaseLike, eventId: string, userId: string, pageIds: string[]) {
  const rows = pageIds.length
    ? await all<OverlapRow>(
        db,
        `WITH candidates AS(
 SELECT current.occurrence_id AS current_id,json_extract(current.payload_json,'$.startAt') AS current_start,json_extract(current.payload_json,'$.endAt') AS current_end,other.occurrence_id AS id,json_extract(other.payload_json,'$.title') AS title,participation.status,json_extract(other.payload_json,'$.startAt') AS start_at,json_extract(other.payload_json,'$.endAt') AS end_at
 FROM event_agenda_published_occurrences current JOIN event_agenda_state state ON state.event_id=current.event_id AND state.published_revision=current.revision
 JOIN agenda_session_participations participation ON participation.event_id=current.event_id AND participation.user_id=? AND (participation.saved=1 OR participation.status IN('saved','reserved','approval_pending','waitlisted')) AND participation.status<>'canceled' AND participation.occurrence_id<>current.occurrence_id
 JOIN event_agenda_published_occurrences other ON other.event_id=current.event_id AND other.revision=current.revision AND other.occurrence_id=participation.occurrence_id
 WHERE current.event_id=? AND current.occurrence_id IN(SELECT value FROM json_each(?))
 AND json_extract(current.payload_json,'$.startAt')<json_extract(other.payload_json,'$.endAt') AND json_extract(other.payload_json,'$.startAt')<json_extract(current.payload_json,'$.endAt')
 AND (json_extract(other.payload_json,'$.visibility')='public' OR participation.status IN('reserved','approval_pending') OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=other.occurrence_id AND invitation.user_id=participation.user_id AND invitation.revoked_at IS NULL))
 ),ranked AS(SELECT current_id,current_start,current_end,id,title,status,start_at,end_at,COUNT(*) OVER(PARTITION BY current_id) AS total,ROW_NUMBER() OVER(PARTITION BY current_id ORDER BY start_at,id) AS position FROM candidates)
 SELECT current_id,current_start,current_end,id,title,status,start_at,end_at,total FROM ranked WHERE position<=5 ORDER BY current_id,position`,
        [userId, eventId, JSON.stringify(pageIds)],
      )
    : [];
  const overlaps = new Map<
    string,
    { overlapCount: number; overlaps: Array<{ id: string; title: string; status: string }> }
  >();
  for (const row of rows) {
    if (!intervalsOverlap(row.current_start, row.current_end, row.start_at, row.end_at)) continue;
    const group = overlaps.get(row.current_id) ?? { overlapCount: Number(row.total), overlaps: [] };
    group.overlaps.push({ id: row.id, title: row.title, status: row.status });
    overlaps.set(row.current_id, group);
  }
  return overlaps;
}
