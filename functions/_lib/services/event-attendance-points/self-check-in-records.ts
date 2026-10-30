/**
 * The organizers' list of self check-ins: who checked in where, how they stood
 * for the day when they did, and whether they held the seat a session asks
 * for. A person appears once per day and place, at their first check-in there,
 * however often they came and went; their movement keeps every scan.
 * Filtering by `expected=no` shows everyone who was in a room without being
 * registered, without an in-person place, or without a booked seat.
 */
import {
  selfCheckInsQuerySchema,
  selfCheckInsResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-movement";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { effectiveAttendanceSql } from "../event-participation/attendance-corrections";
import { assertEventContactAccess, eventContactAccessSql } from "../event-participation/evidence-retention";
import { publishedRoomsSql, publishedSessionsSql } from "../event-participation/published-schedule";
import type { EventRecord } from "../event-types";
import { personNameSql } from "../people/person-name-sql";

/** A person's name, or null when they have not given one. */
export const displayNameSql = personNameSql;

/** A check-in the organizers expected: a registered person with any seat their session asks for. */
export const expectedCheckInSql = (attempt: string) =>
  `(${attempt}.attendee_standing IN ('in_person','remote') AND COALESCE(${attempt}.session_booked,1)=1)`;

interface Row {
  id: string;
  observed_at: string;
  day_date: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  point_kind: string;
  standing: string;
  booked: number | null;
  expected: number;
  session_id: string | null;
  session_title: string | null;
  room_id: string | null;
  room_name: string | null;
}

export async function listSelfCheckIns(db: DatabaseLike, event: EventRecord, raw: unknown) {
  const query = selfCheckInsQuerySchema.parse(raw);
  await assertEventContactAccess(db, event.id);
  const filters = [
    "attempt.event_id=?",
    "attempt.capture_method='self'",
    "attempt.action='attendance'",
    effectiveAttendanceSql("o"),
    eventContactAccessSql("attempt.event_id"),
    "(? IS NULL OR attempt.attendee_standing=?)",
    "(? IS NULL OR attempt.session_booked=(?='booked'))",
    `(? IS NULL OR ${expectedCheckInSql("attempt")}=(?='yes'))`,
    // Only a person's first effective check-in that day at the venue or the session.
    `NOT EXISTS(SELECT 1 FROM event_scan_attempts earlier JOIN event_attendance_observations eo ON eo.attempt_id=earlier.id
     WHERE earlier.event_id=attempt.event_id AND earlier.user_id=attempt.user_id AND earlier.capture_method='self'
     AND earlier.action='attendance' AND earlier.capture_day_date=attempt.capture_day_date
     AND earlier.occurrence_id IS attempt.occurrence_id AND ${effectiveAttendanceSql("eo")}
     AND (earlier.observed_at<attempt.observed_at OR (earlier.observed_at=attempt.observed_at AND earlier.id<attempt.id)))`,
    "(? IS NULL OR attempt.attendance_point_kind=?)",
    "(? IS NULL OR attempt.occurrence_id=?)",
    "(? IS NULL OR attempt.capture_day_date=?)",
  ];
  const pair = (value: string | undefined) => [value ?? null, value ?? null];
  const bindings: unknown[] = [
    event.id,
    ...pair(query.standing),
    ...pair(query.booking),
    ...pair(query.expected),
    ...pair(query.kind),
    ...pair(query.occurrenceId),
    ...pair(query.dayDate),
  ];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [displayNameSql("u"), "u.email", "session.title"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const page = await queryPage<Row>(db, {
    source: {
      selectSql: `SELECT attempt.id,attempt.observed_at,attempt.capture_day_date AS day_date,attempt.user_id,
 ${displayNameSql("u")} AS display_name,u.email,attempt.attendance_point_kind AS point_kind,
 attempt.attendee_standing AS standing,attempt.session_booked AS booked,
 ${expectedCheckInSql("attempt")} AS expected,session.id AS session_id,session.title AS session_title,room.id AS room_id,room.name AS room_name`,
      fromSql: `FROM event_scan_attempts attempt JOIN event_attendance_observations o ON o.attempt_id=attempt.id
 JOIN users u ON u.id=attempt.user_id
 LEFT JOIN (${publishedSessionsSql}) session ON session.event_id=attempt.event_id AND session.id=attempt.occurrence_id
 LEFT JOIN (${publishedRoomsSql}) room ON room.event_id=attempt.event_id AND room.id=attempt.room_id
 WHERE ${filters.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { observedAt: "attempt.observed_at", name: "display_name" },
      "attempt.observed_at DESC",
      "attempt.id",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const checkIns = page.rows.map((row) => ({
    id: row.id,
    observedAt: row.observed_at,
    dayDate: row.day_date,
    person: { userId: row.user_id, displayName: row.display_name, email: row.email },
    pointKind: row.point_kind,
    standing: row.standing,
    booked: row.booked === null ? null : Boolean(row.booked),
    expected: Boolean(row.expected),
    session: row.session_id ? { id: row.session_id, title: row.session_title } : null,
    room: row.room_id ? { id: row.room_id, name: row.room_name } : null,
  }));
  return selfCheckInsResponseSchema.parse({
    checkIns,
    page: buildPageInfo(query.limit, query.offset, page.total, checkIns.length),
  });
}
