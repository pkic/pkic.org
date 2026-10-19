/**
 * Per-session attributed attendance and per-person movement between sessions.
 *
 * Both read in-person session check-ins and check-outs from the one attendance
 * model staff scans and self check-ins share, and run the shared attribution
 * policy, with the event's minimum stay, on the server for the people on the
 * requested page only. Every count is of distinct people, never of scans. Each read is
 * bounded: a page of sessions or people, the published agenda, and at most
 * `MAX_MOVEMENT_EVENTS` check-ins for that page.
 */
import {
  attributeSessionStays,
  eventAttendanceSettings,
  type MovementEvent,
  type SessionStay,
} from "../../../../assets/shared/attendance-attribution";
import {
  attendanceAttributionsQuerySchema,
  attendanceAttributionsResponseSchema,
  attendanceMovementsQuerySchema,
  attendanceMovementsResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-movement";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage } from "../../db/pagination";
import { all } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { effectiveAttendanceSql } from "../event-participation/attendance-corrections";
import { assertEventContactAccess, eventContactAccessSql } from "../event-participation/evidence-retention";
import { publishedRoomsSql, publishedSessionsSql } from "../event-participation/published-schedule";
import type { EventRecord } from "../event-types";
import { parseJsonSafe } from "../../utils/json";
import { displayNameSql, expectedCheckInSql } from "./self-check-in-records";

/** The most check-ins one report page attributes; a larger page asks for fewer rows. */
export const MAX_MOVEMENT_EVENTS = 20_000;
const MAX_AGENDA_SESSIONS = 2_000;

/** Effective session check-ins (not check-outs), with the scan attempt that made them when there was one. */
const sessionCheckInsFrom = (
  joins = "",
) => `FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id${joins}
 WHERE o.event_id=? AND o.occurrence_id IS NOT NULL AND COALESCE(attempt.action,'import')<>'checkout' AND ${effectiveAttendanceSql("o")}`;
const sessionCheckInsSql = sessionCheckInsFrom();

interface SessionRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  room_id: string | null;
  room_name: string | null;
}

const sessionColumns = "s.id,s.title,s.start_at,s.end_at,s.room_id,r.name AS room_name";
const sessionSourceSql = `FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) r ON r.event_id=s.event_id AND r.id=s.room_id
 WHERE s.event_id=? AND s.start_at IS NOT NULL AND s.end_at IS NOT NULL`;

function sessionOf(row: SessionRow) {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    room: row.room_id && row.room_name ? { id: row.room_id, name: row.room_name } : null,
  };
}

async function publishedAgenda(db: DatabaseLike, eventId: string) {
  const rows = await all<SessionRow>(db, `SELECT ${sessionColumns} ${sessionSourceSql} LIMIT ?`, [
    eventId,
    MAX_AGENDA_SESSIONS + 1,
  ]);
  if (rows.length > MAX_AGENDA_SESSIONS)
    throw new AppError(409, "ATTENDANCE_AGENDA_TOO_LARGE", "This agenda has too many sessions to attribute.");
  return new Map(rows.map((row) => [row.id, sessionOf(row)]));
}

/** Each person's in-person session check-ins and check-outs, for the given people only. */
async function movementEvents(db: DatabaseLike, eventId: string, userIds: readonly string[], dayDate?: string) {
  if (!userIds.length) return new Map<string, MovementEvent[]>();
  const rows = await all<{ user_id: string; occurrence_id: string | null; observed_at: string; check_out: number }>(
    db,
    `SELECT o.user_id,o.occurrence_id,o.observed_at,COALESCE(attempt.action,'import')='checkout' AS check_out
     FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
     WHERE o.event_id=? AND o.attendance_mode='physical' AND ${effectiveAttendanceSql("o")}
     AND o.user_id IN (SELECT value FROM json_each(?))
     AND (o.occurrence_id IS NOT NULL OR COALESCE(attempt.action,'import')='checkout')
     AND (? IS NULL OR o.capture_day_date=?)
     ORDER BY o.user_id,o.observed_at,o.rowid LIMIT ?`,
    [eventId, JSON.stringify(userIds), dayDate ?? null, dayDate ?? null, MAX_MOVEMENT_EVENTS + 1],
  );
  if (rows.length > MAX_MOVEMENT_EVENTS)
    throw new AppError(
      409,
      "ATTENDANCE_MOVEMENT_TOO_LARGE",
      "Too many check-ins to attribute at once. Show fewer rows per page.",
    );
  const events = new Map<string, MovementEvent[]>();
  for (const row of rows) {
    const list = events.get(row.user_id) ?? [];
    list.push(
      row.check_out || !row.occurrence_id
        ? { kind: "check_out", at: row.observed_at }
        : { kind: "check_in", sessionId: row.occurrence_id, at: row.observed_at },
    );
    events.set(row.user_id, list);
  }
  return events;
}

/** The share of a session a stay must cover to count, from the event's attendance settings. */
function minimumStayPercent(event: EventRecord): number {
  return eventAttendanceSettings(parseJsonSafe<Record<string, unknown>>(event.settings_json, {})).minimumStayPercent;
}

function staysFor(
  agenda: Awaited<ReturnType<typeof publishedAgenda>>,
  events: readonly MovementEvent[],
  minimumStay: number,
) {
  return attributeSessionStays([...agenda.values()], events, minimumStay);
}

interface AttributionRow extends SessionRow {
  checked_in: number;
  remote: number;
  unexpected: number;
}

/** A page of sessions with in-person, attributed, remote and unexpected attendance. */
export async function attendanceAttributions(db: DatabaseLike, event: EventRecord, raw: unknown) {
  const query = attendanceAttributionsQuerySchema.parse(raw);
  const filters: string[] = [];
  const searchBindings: unknown[] = [];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["s.title", "r.name"]);
    filters.push(search.sql);
    searchBindings.push(...search.bindings);
  }
  const people = (mode: string, extra = "") =>
    `(SELECT COUNT(DISTINCT c.user_id) FROM checkins c WHERE c.occurrence_id=s.id AND c.attendance_mode='${mode}'${extra})`;
  const page = await queryPage<AttributionRow>(db, {
    source: {
      withSql: `WITH checkins AS (SELECT o.occurrence_id,o.user_id,o.attendance_mode,
 CASE WHEN attempt.capture_method='self' THEN ${expectedCheckInSql("attempt")} ELSE 1 END AS expected ${sessionCheckInsSql})`,
      selectSql: `SELECT ${sessionColumns},${people("physical")} AS checked_in,${people("virtual")} AS remote,
 ${people("physical", " AND NOT c.expected")} AS unexpected`,
      fromSql: `${sessionSourceSql}${filters.map((filter) => ` AND ${filter}`).join("")}`,
      bindings: [event.id, event.id, ...searchBindings],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { startAt: "s.start_at", title: "s.title", checkedIn: "checked_in" },
      "s.start_at",
      "s.id",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const pageIds = page.rows.map((row) => row.id);
  const attendees = pageIds.length
    ? await all<{ user_id: string }>(
        db,
        `SELECT DISTINCT o.user_id ${sessionCheckInsSql} AND o.attendance_mode='physical' AND o.occurrence_id IN (SELECT value FROM json_each(?))`,
        [event.id, JSON.stringify(pageIds)],
      )
    : [];
  const attributed = new Map<string, number>();
  const minimumStay = minimumStayPercent(event);
  if (attendees.length) {
    const agenda = await publishedAgenda(db, event.id);
    const events = await movementEvents(
      db,
      event.id,
      attendees.map((row) => row.user_id),
    );
    for (const personEvents of events.values())
      for (const stay of staysFor(agenda, personEvents, minimumStay))
        if (stay.attributed) attributed.set(stay.sessionId, (attributed.get(stay.sessionId) ?? 0) + 1);
  }
  const sessions = page.rows.map((row) => ({
    session: sessionOf(row),
    checkedIn: row.checked_in,
    attributed: attributed.get(row.id) ?? 0,
    remote: row.remote,
    unexpected: row.unexpected,
  }));
  return attendanceAttributionsResponseSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, page.total, sessions.length),
    minimumStayPercent: minimumStay,
  });
}

interface PersonRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  first_check_in_at: string;
}

/** A page of people with their in-person stays in order, each marked attributed or not. */
export async function attendanceMovements(db: DatabaseLike, event: EventRecord, raw: unknown) {
  const query = attendanceMovementsQuerySchema.parse(raw);
  await assertEventContactAccess(db, event.id);
  const filters = [
    "o.attendance_mode='physical'",
    eventContactAccessSql("o.event_id"),
    "(? IS NULL OR o.capture_day_date=?)",
    "(? IS NULL OR o.user_id=?)",
  ];
  const bindings: unknown[] = [
    event.id,
    query.dayDate ?? null,
    query.dayDate ?? null,
    query.userId ?? null,
    query.userId ?? null,
  ];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [displayNameSql("u"), "u.email"]);
    filters.push(search.sql);
    bindings.push(...search.bindings);
  }
  const page = await queryPage<PersonRow>(db, {
    sql: `SELECT o.user_id,${displayNameSql("u")} AS display_name,u.email,MIN(o.observed_at) AS first_check_in_at
 ${sessionCheckInsFrom(" JOIN users u ON u.id=o.user_id")} AND ${filters.join(" AND ")}
 GROUP BY o.user_id`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "display_name", firstCheckInAt: "first_check_in_at" },
      "display_name",
      "o.user_id",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  const agenda = page.rows.length ? await publishedAgenda(db, event.id) : new Map();
  const events = await movementEvents(
    db,
    event.id,
    page.rows.map((row) => row.user_id),
    query.dayDate,
  );
  const minimumStay = minimumStayPercent(event);
  const people = page.rows.map((row) => ({
    person: { userId: row.user_id, displayName: row.display_name, email: row.email },
    firstCheckInAt: row.first_check_in_at,
    stays: staysFor(agenda, events.get(row.user_id) ?? [], minimumStay).map((stay: SessionStay) => ({
      session: agenda.get(stay.sessionId)!,
      checkedInAt: stay.checkedInAt,
      leftAt: stay.leftAt,
      dwellSeconds: stay.dwellSeconds,
      tooShort: stay.tooShort,
      attributed: stay.attributed,
    })),
  }));
  return attendanceMovementsResponseSchema.parse({
    people,
    page: buildPageInfo(query.limit, query.offset, page.total, people.length),
    minimumStayPercent: minimumStay,
  });
}
