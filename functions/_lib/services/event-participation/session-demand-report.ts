import {
  sessionDemandReportQuerySchema,
  sessionDemandReportExportQuerySchema,
  sessionDemandReportRowSchema,
  sessionDemandReportResponseSchema,
  sessionDemandReportMetadataSchema,
  sessionDemandReportExportLimits,
  type SessionDemandReportExportQuery,
  type SessionDemandReportRow,
} from "../../../../assets/shared/schemas/event-session-demand-report";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { resolveMappedOrderBy } from "../../db/sort";
import { guardPermissionDatabase, permissionsAuthorizationEvidence } from "../../auth/permissions";
import { encodeBoundedCsv } from "../../csv";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { physicalOccupiedSql, remoteOccupiedSql, physicalRoomOccupiedSql } from "./capacity-accounting";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { sessionDemandAggregateSql } from "./session-demand-query";

function requirements(eventId: string) {
  return [{ permission: "agenda:read" as const, context: { type: "event" as const, id: eventId } }];
}
function permissionChanged() {
  return new AppError(403, "SESSION_DEMAND_PERMISSION_CHANGED", "Your agenda reading permission changed.");
}
async function authorized(db: DatabaseLike, eventId: string, actor: AuthAdmin) {
  const evidence = permissionsAuthorizationEvidence(actor, requirements(eventId));
  if (!(await first(db, evidence.sql, [...evidence.bindings]))) throw permissionChanged();
}
function guarded(db: DatabaseLike, eventId: string, actor: AuthAdmin) {
  return guardPermissionDatabase(db, actor, requirements(eventId), permissionChanged);
}
async function reportContext(db: DatabaseLike, eventId: string, query: SessionDemandReportExportQuery) {
  const row = await first<{ timeZone: string; publishedRevision: number | null }>(
    db,
    `SELECT COALESCE(json_extract(publication.snapshot_json,'$.timeZone'),event.timezone,'UTC') AS timeZone,
      state.published_revision AS publishedRevision FROM events event
      LEFT JOIN event_agenda_state state ON state.event_id=event.id
      LEFT JOIN event_agenda_publications publication ON publication.event_id=event.id AND publication.revision=state.published_revision
      WHERE event.id=?`,
    [eventId],
  );
  if (!row) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  let dayStart: string | null = null,
    dayEnd: string | null = null;
  if (query.dayDate) {
    const [year, month, day] = query.dayDate.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    try {
      dayStart = zonedDateTimeToDate({ year, month, day, hour: 0, minute: 0, second: 0 }, row.timeZone).toISOString();
      dayEnd = zonedDateTimeToDate(
        {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
          hour: 0,
          minute: 0,
          second: 0,
        },
        row.timeZone,
      ).toISOString();
    } catch {
      throw new AppError(
        422,
        "SESSION_DEMAND_DAY_UNAVAILABLE",
        "This calendar day cannot be resolved in the published agenda timezone.",
      );
    }
  }
  return {
    report: sessionDemandReportMetadataSchema.parse({
      eventId,
      scheduleBasis: "published_agenda",
      ...row,
      dayDate: query.dayDate ?? null,
      generatedAt: nowIso(),
    }),
    dayStart,
    dayEnd,
  };
}
async function assertPublication(db: DatabaseLike, eventId: string, expectedRevision: number | null) {
  const row = await first<{ revision: number | null }>(
    db,
    "SELECT state.published_revision AS revision FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id WHERE event.id=?",
    [eventId],
  );
  if (!row || row.revision !== expectedRevision)
    throw new AppError(409, "SESSION_DEMAND_PUBLICATION_CHANGED", "The published agenda changed. Refresh this report.");
}
/** The same filtered population and allowlisted ordering serve JSON and complete CSV. */
async function reportQuery(db: DatabaseLike, eventId: string, query: SessionDemandReportExportQuery) {
  const context = await reportContext(db, eventId, query);
  const filters = ["session.event_id=?", "session.published_revision IS ?"];
  const bindings: unknown[] = [eventId, context.report.publishedRevision];
  if (query.q) {
    filters.push("INSTR(LOWER(session.title),LOWER(?))>0");
    bindings.push(query.q);
  }
  if (query.occurrenceId) {
    filters.push("session.id=?");
    bindings.push(query.occurrenceId);
  }
  if (query.admissionPolicy) {
    filters.push("session.admission_policy=?");
    bindings.push(query.admissionPolicy);
  }
  if (query.accessPolicy) {
    filters.push("session.access_policy=?");
    bindings.push(query.accessPolicy);
  }
  if (query.roomId) {
    filters.push(
      "(session.room_id=? OR EXISTS(SELECT 1 FROM json_each(session.additional_room_ids_json) room_id WHERE room_id.value=?))",
    );
    bindings.push(query.roomId, query.roomId);
  }
  if (context.dayStart && context.dayEnd) {
    filters.push("session.start_at>=? AND session.start_at<?");
    bindings.push(context.dayStart, context.dayEnd);
  }
  const modeFilters: string[] = [];
  if (query.attendanceMode) {
    modeFilters.push("mode.attendance_mode=?");
    bindings.push(query.attendanceMode);
  }
  if (query.roomId) modeFilters.push("mode.attendance_mode='physical'");
  const sql = `WITH selected AS (SELECT session.id,session.event_id,session.published_revision,session.title,session.start_at,session.end_at,session.room_id,session.additional_room_ids_json,session.admission_policy,session.access_policy,session.capacity,session.remote_capacity FROM (${publishedSessionsSql}) session WHERE ${filters.join(" AND ")}),
    demand AS (${sessionDemandAggregateSql("SELECT id,event_id FROM selected")}),
    modes AS (SELECT 'physical' AS attendance_mode UNION ALL SELECT 'remote')
    SELECT selected.id AS occurrenceId,selected.title,selected.start_at AS startAt,selected.end_at AS endAt,
      selected.admission_policy AS admissionPolicy,selected.access_policy AS accessPolicy,mode.attendance_mode AS attendanceMode,
      COALESCE(demand.confirmed,0) AS confirmed,COALESCE(demand.pending,0) AS pending,
      COALESCE(demand.waitlisted,0) AS waitlisted,COALESCE(demand.preferences,0) AS preferences,
      CASE WHEN mode.attendance_mode='physical' THEN ${physicalOccupiedSql("selected.id")} ELSE ${remoteOccupiedSql("selected.id")} END AS occupied,
      CASE WHEN mode.attendance_mode='physical' THEN selected.capacity ELSE selected.remote_capacity END AS sessionCapacity,
      CASE WHEN mode.attendance_mode='physical' THEN
        (SELECT json_group_array(json_object('id',room.id,'name',room.name,'capacity',room.capacity,'occupied',${physicalRoomOccupiedSql("selected.id", "room.id")}))
          FROM (${publishedRoomsSql}) room WHERE room.event_id=selected.event_id
          AND (room.id=selected.room_id OR EXISTS(SELECT 1 FROM json_each(selected.additional_room_ids_json) additional WHERE additional.value=room.id)))
        ELSE '[]' END AS locations_json
    FROM selected CROSS JOIN modes mode
      LEFT JOIN demand ON demand.occurrence_id=selected.id AND demand.attendance_mode=mode.attendance_mode
    ${modeFilters.length ? `WHERE ${modeFilters.join(" AND ")}` : ""}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      title: "title COLLATE NOCASE",
      startAt: "startAt",
      preferences: "preferences",
      confirmed: "confirmed",
      pending: "pending",
      waitlisted: "waitlisted",
      occupied: "occupied",
      sessionCapacity: "sessionCapacity",
    },
    "startAt ASC",
    "occurrenceId ASC,attendanceMode ASC",
  );
  return { sql, bindings, orderBy, report: context.report };
}
function parseRow(row: Record<string, unknown>): SessionDemandReportRow {
  const { locations_json, exportTotal: _exportTotal, ...fields } = row;
  return sessionDemandReportRowSchema.parse({ ...fields, locations: JSON.parse(String(locations_json)) });
}
export async function eventSessionDemandReport(db: DatabaseLike, eventId: string, actor: AuthAdmin, raw: unknown) {
  const query = sessionDemandReportQuerySchema.parse(raw);
  await authorized(db, eventId, actor);
  const built = await reportQuery(db, eventId, query);
  const result = await queryPage<Record<string, unknown>>(guarded(db, eventId, actor), {
    sql: built.sql,
    bindings: built.bindings,
    orderBy: built.orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  await assertPublication(db, eventId, built.report.publishedRevision);
  return sessionDemandReportResponseSchema.parse({
    sessions: result.rows.map(parseRow),
    page: buildPageInfo(query.limit, query.offset, result.total, result.rows.length),
    report: built.report,
  });
}
const csvColumns = [
  "occurrenceId",
  "title",
  "startAt",
  "endAt",
  "admissionPolicy",
  "accessPolicy",
  "attendanceMode",
  "preferences",
  "confirmed",
  "pending",
  "waitlisted",
  "occupied",
  "sessionCapacity",
] as const;
/** One bounded snapshot population, never an offset-page traversal or partial export. */
export async function exportSessionDemandReport(
  db: DatabaseLike,
  eventId: string,
  actor: AuthAdmin,
  raw: unknown,
  limits: { maxRows: number; maxBytes: number } = sessionDemandReportExportLimits,
) {
  const query = sessionDemandReportExportQuerySchema.parse(raw);
  await authorized(db, eventId, actor);
  const built = await reportQuery(db, eventId, query);
  const access = guarded(db, eventId, actor);
  const [result] = await access.batch([
    access
      .prepare(
        `SELECT ${[...csvColumns, "locations_json"].map((column) => `exported.${column}`).join(",")},COUNT(*) OVER() AS exportTotal FROM (${built.sql}) exported ${built.orderBy} LIMIT ?`,
      )
      .bind(...built.bindings, limits.maxRows + 1),
  ]);
  const rows = (result.results ?? []) as Record<string, unknown>[];
  if (rows.length > limits.maxRows || Number(rows[0]?.exportTotal ?? 0) > limits.maxRows)
    throw new AppError(
      413,
      "SESSION_DEMAND_EXPORT_ROW_LIMIT",
      "Narrow the filters; this demand export exceeds its row limit.",
    );
  const sessions = rows.map(parseRow);
  const csv = encodeBoundedCsv(
    [
      [...csvColumns, "locations", "scheduleBasis", "publishedRevision", "timeZone", "scopeDayDate", "generatedAt"],
      ...sessions.map((row) => [
        ...csvColumns.map((key) => row[key]),
        JSON.stringify(row.locations),
        built.report.scheduleBasis,
        built.report.publishedRevision,
        built.report.timeZone,
        built.report.dayDate,
        built.report.generatedAt,
      ]),
    ],
    limits.maxBytes,
  );
  await assertPublication(db, eventId, built.report.publishedRevision);
  await access.batch([
    prepareScopedAuditLog(
      access,
      { type: "event", id: eventId },
      "admin",
      actor.id,
      "agenda.session_demand.exported",
      "event",
      eventId,
      {
        filters: query,
        rowCount: sessions.length,
        scheduleBasis: built.report.scheduleBasis,
        publishedRevision: built.report.publishedRevision,
      },
    ),
  ]);
  return { csv, rowCount: sessions.length, report: built.report };
}
