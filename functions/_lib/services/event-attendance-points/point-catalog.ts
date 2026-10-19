/**
 * The event's check-in codes, derived from its days, its published rooms and
 * its published sessions. Nothing here is stored except the signing key.
 */
import type { AttendancePointSelection } from "../../../../assets/shared/attendance-points";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import {
  attendancePointsQuerySchema,
  attendancePointsResponseSchema,
  type AttendancePoint,
} from "../../../../assets/shared/schemas/event-attendance-points";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { publishedRoomsSql, publishedSessionsSql } from "../event-participation/published-schedule";
import type { EventRecord } from "../event-types";
import { pointDaysCte } from "./point-days";
import { attendancePointPath, ensureAttendancePointKey, signAttendancePoint } from "./point-keys";

interface PointRow {
  kind: AttendancePoint["kind"];
  label: string;
  day_date: string | null;
  day_label: string | null;
  room_id: string | null;
  room_name: string | null;
  occurrence_id: string | null;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
}

/** Every derivable point as one source, so filters, search and paging stay in SQL. */
function pointsSource(event: EventRecord) {
  const days = pointDaysCte(event);
  return {
    withSql: `WITH ${days.sql}, rooms AS (${publishedRoomsSql}), sessions AS (${publishedSessionsSql}),
points AS (
 SELECT 'venue_check_in' AS kind,0 AS kind_order,day_label||' check-in' AS label,day_date,day_label,NULL AS room_id,NULL AS room_name,
  NULL AS occurrence_id,NULL AS title,NULL AS start_at,NULL AS end_at,position AS sort_key FROM point_days
 UNION ALL SELECT 'venue_check_out',1,day_label||' check-out',day_date,day_label,NULL,NULL,NULL,NULL,NULL,NULL,position FROM point_days
 UNION ALL SELECT 'room',2,name,NULL,NULL,id,name,NULL,NULL,NULL,NULL,position FROM rooms WHERE event_id=?
 UNION ALL SELECT 'session',3,s.title,NULL,NULL,s.room_id,r.name,s.id,s.title,s.start_at,s.end_at,s.start_at
  FROM sessions s LEFT JOIN rooms r ON r.event_id=s.event_id AND r.id=s.room_id
  WHERE s.event_id=? AND s.start_at IS NOT NULL AND s.end_at IS NOT NULL
)`,
    bindings: [...days.bindings, event.id, event.id],
  };
}

function selectionOf(row: PointRow): AttendancePointSelection {
  if (row.kind === "room") return { kind: "room", roomId: row.room_id! };
  if (row.kind === "session") return { kind: "session", occurrenceId: row.occurrence_id! };
  return { kind: row.kind, dayDate: row.day_date! };
}

export async function listAttendancePoints(
  db: DatabaseLike,
  signingSecret: string,
  event: EventRecord,
  raw: unknown,
  canReissue: boolean,
) {
  const query = attendancePointsQuerySchema.parse(raw);
  const key = await ensureAttendancePointKey(db, event.id);
  const source = pointsSource(event);
  const filters = [
    // Session codes are many and meant for screens; they are listed only when asked for.
    "(CASE WHEN ? IS NOT NULL THEN kind=? WHEN ? IS NOT NULL THEN kind='session' ELSE kind<>'session' END)",
    "(? IS NULL OR day_date=?)",
    "(? IS NULL OR room_id=?)",
    "(? IS NULL OR occurrence_id=?)",
  ];
  const bindings: unknown[] = [
    query.kind ?? null,
    query.kind ?? null,
    query.occurrenceId ?? null,
    query.dayDate ?? null,
    query.dayDate ?? null,
    query.roomId ?? null,
    query.roomId ?? null,
    query.occurrenceId ?? null,
    query.occurrenceId ?? null,
  ];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["label"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const page = await queryPage<PointRow>(db, {
    source: {
      withSql: source.withSql,
      selectSql: "SELECT kind,label,day_date,day_label,room_id,room_name,occurrence_id,title,start_at,end_at",
      fromSql: `FROM points WHERE ${filters.join(" AND ")}`,
      bindings: [...source.bindings, ...bindings],
    },
    orderBy: resolveMappedOrderBy(query.sort, { label: "label" }, "kind_order,sort_key,label", "kind,label"),
    limit: query.limit,
    offset: query.offset,
  });
  const points = await Promise.all(
    page.rows.map(async (row) => {
      const token = await signAttendancePoint(signingSecret, key, event.id, selectionOf(row));
      const room = row.room_id && row.room_name ? { id: row.room_id, name: row.room_name } : null;
      return {
        kind: row.kind,
        label: row.label,
        dayDate: row.day_date,
        dayLabel: row.day_label,
        room: row.kind === "session" ? null : room,
        session:
          row.kind === "session"
            ? { id: row.occurrence_id!, title: row.title!, startAt: row.start_at!, endAt: row.end_at!, room }
            : null,
        token,
        path: attendancePointPath(event.slug, token),
      } satisfies AttendancePoint;
    }),
  );
  return attendancePointsResponseSchema.parse({
    points,
    page: buildPageInfo(query.limit, query.offset, page.total, points.length),
    timeZone: event.timezone,
    clockCity: eventClockCity(event.city),
    issuedAt: key.issued_at,
    canReissue,
  });
}
