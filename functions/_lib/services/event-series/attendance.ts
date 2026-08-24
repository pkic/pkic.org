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
import { prepareAuditLogAfterOneChange } from "../audit";
import { requireGroupManagement } from "../groups/governance";
import { getSeriesOccurrence } from "./occurrences";

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

export async function listOccurrenceAttendance(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  query: AttendanceQuery,
) {
  const { series } = await getSeriesOccurrence(db, groupIdOrSlug, seriesId, occurrenceId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
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
      query.verified === "true"
        ? "confirmation.attendance_verified_at IS NOT NULL"
        : "confirmation.attendance_verified_at IS NULL",
    );
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows, total } = await queryPage<AttendanceRow>(db, {
    source: {
      selectSql: `SELECT ${ATTENDANCE_COLUMNS}`,
      fromSql: `FROM event_occurrence_join_confirmations confirmation ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(query.sort, SORT_EXPRESSIONS, SORT_EXPRESSIONS.name, "confirmation.id ASC"),
    limit: query.limit,
    offset: query.offset,
  });
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
  const { series } = await getSeriesOccurrence(db, groupIdOrSlug, seriesId, occurrenceId);
  await requireGroupManagement(db, actor, series.ownerGroupId);
  const existing = await first<AttendanceRow>(
    db,
    `SELECT ${ATTENDANCE_COLUMNS} FROM event_occurrence_join_confirmations confirmation
      WHERE confirmation.id = ? AND confirmation.occurrence_id = ?`,
    [confirmationId, occurrenceId],
  );
  if (!existing) throw new AppError(404, "MEETING_JOIN_CONFIRMATION_NOT_FOUND", "Join confirmation not found");
  const verifiedAt = input.verifiedAt ?? nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE event_occurrence_join_confirmations
            SET attendance_verified_at = ?, attendance_verification_source = ?, updated_at = ?
          WHERE id = ? AND occurrence_id = ?`,
      )
      .bind(verifiedAt, input.source, nowIso(), confirmationId, occurrenceId),
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      actor.id,
      "event_occurrence_attendance_verified",
      "event_occurrence_join_confirmation",
      confirmationId,
      { occurrenceId, source: input.source, verifiedAt, note: input.note },
    ),
  ]);
  return toAttendance({
    ...existing,
    attendance_verified_at: verifiedAt,
    attendance_verification_source: input.source,
  });
}
