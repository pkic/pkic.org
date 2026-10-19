/**
 * Live venue counts per event day from staff badge scans and attendee self
 * check-ins together. Checked in counts everyone with a venue check-in that
 * day; checked out counts those whose latest venue scan is a check-out; on
 * site is the difference. A check-out changes only these counts.
 */
import { dayOccupancy } from "../../../../assets/shared/attendance-points";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import {
  attendanceOccupancyQuerySchema,
  attendanceOccupancyResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-points";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import type { EventRecord } from "../event-types";
import { pointDaysCte } from "./point-days";
import { venueEventsSql } from "./venue-presence";

interface OccupancyRow {
  day_date: string;
  day_label: string;
  capacity: number | null;
  checked_in: number;
  checked_out: number;
  self_check_ins: number;
  staff_check_ins: number;
}

export async function attendanceOccupancy(db: DatabaseLike, event: EventRecord, raw: unknown) {
  const query = attendanceOccupancyQuerySchema.parse(raw);
  const days = pointDaysCte(event);
  const page = await queryPage<OccupancyRow>(db, {
    source: {
      withSql: `WITH ${days.sql}, venue AS (${venueEventsSql} AND o.event_id=?),
 arrivals AS (SELECT day_date,user_id,MAX(method='self') AS by_self,MAX(method<>'self') AS by_staff FROM venue WHERE direction='check_in' GROUP BY day_date,user_id),
 departed AS (SELECT latest.day_date,latest.user_id FROM venue latest JOIN arrivals arrived ON arrived.day_date=latest.day_date AND arrived.user_id=latest.user_id
  WHERE latest.recency=1 AND latest.direction='check_out')`,
      selectSql: `SELECT d.day_date,d.day_label,COALESCE(d.capacity,?) AS capacity,
 (SELECT COUNT(*) FROM arrivals a WHERE a.day_date=d.day_date) AS checked_in,
 (SELECT COUNT(*) FROM departed g WHERE g.day_date=d.day_date) AS checked_out,
 (SELECT COUNT(*) FROM arrivals a WHERE a.day_date=d.day_date AND a.by_self) AS self_check_ins,
 (SELECT COUNT(*) FROM arrivals a WHERE a.day_date=d.day_date AND a.by_staff) AS staff_check_ins`,
      fromSql: "FROM point_days d WHERE (? IS NULL OR d.day_date=?)",
      bindings: [...days.bindings, event.id, event.capacity_in_person, query.dayDate ?? null, query.dayDate ?? null],
      countBindings: [...days.bindings, event.id, query.dayDate ?? null, query.dayDate ?? null],
    },
    orderBy: resolveMappedOrderBy(query.sort, { dayDate: "d.day_date" }, "d.day_date", "d.day_date"),
    limit: query.limit,
    offset: query.offset,
  });
  const rows = page.rows.map((row) => ({
    dayDate: row.day_date,
    dayLabel: row.day_label,
    ...dayOccupancy({ checkedIn: row.checked_in, checkedOut: row.checked_out, capacity: row.capacity }),
    selfCheckIns: row.self_check_ins,
    staffCheckIns: row.staff_check_ins,
  }));
  return attendanceOccupancyResponseSchema.parse({
    days: rows,
    page: buildPageInfo(query.limit, query.offset, page.total, rows.length),
    generatedAt: nowIso(),
    timeZone: event.timezone,
    clockCity: eventClockCity(event.city),
  });
}
