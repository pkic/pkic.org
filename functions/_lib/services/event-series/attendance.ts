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
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { getGroup } from "../groups";
import { requireGroupResourceAccess } from "../resource-grants";

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

interface AttendanceManagementContext {
  groupId: string;
  eventId: string;
}

async function requireAttendanceManagementContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
): Promise<AttendanceManagementContext> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  const context = await first<{ event_id: string }>(
    db,
    `SELECT series.event_id
       FROM event_series series
       JOIN event_occurrences occurrence ON occurrence.series_id = series.id
      WHERE series.id = ? AND occurrence.id = ?`,
    [seriesId, occurrenceId],
  );
  if (!context) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found in this series");
  await requireGroupResourceAccess(db, actor, "event", context.event_id, "manage_attendance", group.id);
  return { groupId: group.id, eventId: context.event_id };
}

function prepareAttendanceManagementGuard(db: DatabaseLike, actor: AuthAdmin, context: AttendanceManagementContext) {
  return db
    .prepare(
      `INSERT INTO event_attendance_management_guards
         (id, event_id, group_id, actor_user_id, trusted_service, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuid(),
      context.eventId,
      context.groupId,
      actor.identityType === "user" ? actor.id : null,
      actor.identityType === "service" ? 1 : 0,
      nowIso(),
    );
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
    await db.batch([
      prepareAttendanceManagementGuard(db, actor, context),
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
    if (error instanceof Error && error.message.includes("EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED")) {
      throw new AppError(
        409,
        "EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED",
        "Attendance-management access changed while the verification was being saved",
      );
    }
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
