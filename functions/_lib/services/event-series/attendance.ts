import type { z } from "zod";
import {
  EVENT_ATTENDANCE_SORT_COLUMNS,
  attendanceVerifySchema,
  eventAttendanceListQuerySchema,
  eventOccurrenceJoinConfirmationSchema,
} from "../../../../assets/shared/schemas/event-series";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import {
  commitEventResourceManagementBatch,
  requireEventResourceManagementContext,
  type EventResourceManagementContext,
} from "./management";

type AttendanceQuery = z.infer<typeof eventAttendanceListQuerySchema>;
type AttendanceVerifyInput = z.infer<typeof attendanceVerifySchema>;

interface AttendanceRow {
  id: string;
  occurrence_id: string;
  user_id: string | null;
  guest_id: string | null;
  name_snapshot: string;
  affiliation_snapshot: string | null;
  join_count: number;
  confirmed_at: string;
  attendance_verified_at: string | null;
  attendance_verification_source: "microsoft_graph" | "cloudflare_meet" | "manual" | null;
}

const ATTENDANCE_COLUMNS = `confirmation.id, confirmation.occurrence_id, confirmation.user_id,
  confirmation.guest_id, confirmation.name_snapshot, confirmation.affiliation_snapshot,
  confirmation.join_count, confirmation.confirmed_at, confirmation.attendance_verified_at,
  confirmation.attendance_verification_source`;

function toAttendance(row: AttendanceRow) {
  return eventOccurrenceJoinConfirmationSchema.parse({
    id: row.id,
    occurrenceId: row.occurrence_id,
    userId: row.user_id,
    guestId: row.guest_id,
    name: row.name_snapshot,
    affiliation: row.affiliation_snapshot,
    joinCount: row.join_count,
    confirmedAt: row.confirmed_at,
    attendanceVerifiedAt: row.attendance_verified_at,
    attendanceVerificationSource: row.attendance_verification_source,
  });
}

const SORT_EXPRESSIONS = {
  name: "confirmation.name_snapshot COLLATE NOCASE",
  confirmed_at: "confirmation.confirmed_at",
  attendance_verified_at: "confirmation.attendance_verified_at",
} satisfies Record<(typeof EVENT_ATTENDANCE_SORT_COLUMNS)[number], string>;

async function requireAttendanceManagementContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
): Promise<EventResourceManagementContext> {
  const context = await first<{ event_id: string }>(
    db,
    `SELECT series.event_id
       FROM event_series series
       JOIN event_occurrences occurrence ON occurrence.series_id = series.id
      WHERE series.id = ? AND occurrence.id = ?`,
    [seriesId, occurrenceId],
  );
  if (!context) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found in this series");
  return requireEventResourceManagementContext(db, actor, groupIdOrSlug, context.event_id, "manage_attendance");
}

/** Canonical page/count query for occurrence attendance, also used by EXPLAIN tests. */
export function buildOccurrenceAttendancePageQuery(occurrenceId: string, query: AttendanceQuery) {
  const conditions = ["confirmation.occurrence_id = ?"];
  const bindings: unknown[] = [occurrenceId];
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["confirmation.name_snapshot", "confirmation.affiliation_snapshot"])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.verified !== undefined) {
    conditions.push(
      query.verified
        ? "confirmation.attendance_verified_at IS NOT NULL"
        : "confirmation.attendance_verified_at IS NULL",
    );
  }
  return {
    source: {
      selectSql: `SELECT ${ATTENDANCE_COLUMNS}`,
      fromSql: `FROM event_occurrence_join_confirmations confirmation WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.name, "confirmation.id ASC"),
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listOccurrenceAttendance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  query: AttendanceQuery,
) {
  await requireAttendanceManagementContext(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const { rows, total } = await queryPage<AttendanceRow>(db, buildOccurrenceAttendancePageQuery(occurrenceId, query));
  return { confirmations: rows.map(toAttendance), total };
}

export async function verifyOccurrenceAttendance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  confirmationId: string,
  input: AttendanceVerifyInput,
) {
  const context = await requireAttendanceManagementContext(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const existing = await first<AttendanceRow>(
    db,
    `SELECT ${ATTENDANCE_COLUMNS} FROM event_occurrence_join_confirmations confirmation
      WHERE confirmation.id = ? AND confirmation.occurrence_id = ?`,
    [confirmationId, occurrenceId],
  );
  if (!existing) throw new AppError(404, "MEETING_JOIN_CONFIRMATION_NOT_FOUND", "Join confirmation not found");
  const verifiedAt = input.verifiedAt ?? nowIso();
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage_attendance", [
      db
        .prepare(
          `UPDATE event_occurrence_join_confirmations
              SET attendance_verified_at = ?, attendance_verification_source = ?, updated_at = ?
            WHERE id = ? AND occurrence_id = ?`,
        )
        .bind(verifiedAt, input.source, nowIso(), confirmationId, occurrenceId),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_occurrence_attendance_verified",
        "event_occurrence_join_confirmation",
        confirmationId,
        { occurrenceId, source: input.source, verifiedAt, note: input.note },
      ),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "MEETING_JOIN_CONFIRMATION_CHANGED",
        "The join confirmation changed while attendance verification was being saved",
      );
    }
    throw error;
  }
  return toAttendance({
    ...existing,
    attendance_verified_at: verifiedAt,
    attendance_verification_source: input.source,
  });
}
