import { personalAvailability } from "./personal-availability";
import { personalAgendaOverlaps } from "./personal-agenda-overlaps";
import {
  personalAgendaProgramResponseSchema,
  personalAgendaQuerySchema,
  personalAgendaResponseSchema,
} from "../../../../assets/shared/schemas/event-personal-agenda";
import { previewAgenda } from "../event-agenda/preview";
import { AppError } from "../../errors";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { approvedVirtualRoomUrlSql, draftVirtualRoomUrlSql } from "../event-agenda/virtual-room-links";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
/**
 * A private session reaches a participant only when they hold a place on it
 * (reserved or awaiting approval) or an unrevoked invitation. Expects the
 * session as `s`, the viewer's participation as `p`, and binds the viewer once.
 */
const privateSessionAccessSql = `(p.status IN ('reserved','approval_pending') OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=? AND invitation.revoked_at IS NULL))`;

export async function personalAgenda(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const query = personalAgendaQuerySchema.parse(raw);
  const where = `s.event_id=? AND (s.visibility='public' OR ${privateSessionAccessSql}) AND INSTR(LOWER(s.title),LOWER(?))>0 AND (? IS NULL OR p.status=?) AND (? IS NULL OR s.id=?)
    AND (? IS NULL OR s.end_at>?) AND (?=0 OR COALESCE(p.saved,0)=1 OR p.status IN ('saved','reserved','approval_pending','waitlisted'))`;
  const bindings = [
    userId,
    eventId,
    userId,
    query.q ?? "",
    query.status ?? null,
    query.status ?? null,
    query.occurrenceId ?? null,
    query.occurrenceId ?? null,
    query.from ?? null,
    query.from ?? null,
    query.mine ? 1 : 0,
  ];
  const from = `FROM (${publishedSessionsSql}) s LEFT JOIN agenda_session_participations p ON p.occurrence_id=s.id AND p.user_id=?`;
  const count = await first<{ total: number }>(db, `SELECT COUNT(*) AS total ${from} WHERE ${where}`, bindings);
  const sort =
    query.sort === "title"
      ? "s.title ASC"
      : query.sort === "-title"
        ? "s.title DESC"
        : query.sort === "-startAt"
          ? "s.start_at DESC"
          : "s.start_at ASC";
  const sessions = await all(
    db,
    `SELECT s.id,s.published_revision AS publishedRevision,s.title,EXISTS(SELECT 1 FROM event_agenda_published_occurrences approved JOIN events event ON event.id=approved.event_id WHERE approved.event_id=s.event_id AND approved.revision=s.published_revision AND approved.occurrence_id=s.id AND ${approvedVirtualRoomUrlSql("approved")} IS NOT NULL AND ${approvedVirtualRoomUrlSql("approved")} IS ${draftVirtualRoomUrlSql("approved.occurrence_id", "event.settings_json")}) AS online_access_available,p.room_id AS roomId,(SELECT json_group_array(json_object('id',location.id,'name',location.name)) FROM (${publishedRoomsSql}) location WHERE location.event_id=s.event_id AND (location.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) selected WHERE selected.value=location.id))) AS rooms_json,s.timezone AS timeZone,s.start_at AS startAt,s.end_at AS endAt,s.admission_policy AS admissionPolicy,s.visibility,p.status,COALESCE(p.saved,0) AS saved,p.attendance_mode AS attendanceMode ${from} WHERE ${where} ORDER BY ${sort},s.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  const overlapGroups = await personalAgendaOverlaps(
    db,
    eventId,
    userId,
    sessions.map((row) => String((row as { id: string }).id)),
  );
  const availabilityGroups = await personalAvailability(
    db,
    eventId,
    userId,
    sessions as Array<{ id: string; startAt: string | null; timeZone: string }>,
  );
  return personalAgendaResponseSchema.parse({
    sessions: sessions.map((row) => {
      const { rooms_json, online_access_available, ...session } = row as Record<string, unknown>;
      return {
        ...session,
        saved: Boolean(session.saved),
        onlineAccessAvailable: Boolean(online_access_available),
        ...overlapGroups.get(String(session.id)),
        availability: availabilityGroups.get(String(session.id)) ?? [],
        rooms: JSON.parse(String(rooms_json ?? "[]")),
      };
    }),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}

/**
 * The exact approved public projection (as published), plus the private
 * sessions this viewer is invited to or holds a place on, plus only the
 * viewer's own active marks.
 */
export async function personalAgendaProgram(db: DatabaseLike, event: { id: string; slug: string }, userId: string) {
  const ownPrivate = await all<{ id: string }>(
    db,
    `SELECT s.id FROM (${publishedSessionsSql}) s LEFT JOIN agenda_session_participations p ON p.occurrence_id=s.id AND p.user_id=?
      WHERE s.event_id=? AND s.visibility='private' AND ${privateSessionAccessSql}`,
    [userId, event.id, userId],
  );
  const include = new Set(ownPrivate.map((row) => row.id));
  const agenda = await previewAgenda(db, event.id, event.slug, "approved", include).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "AGENDA_APPROVED_REVISION_NOT_FOUND") return null;
    throw error;
  });
  const published = new Set(agenda?.occurrences.map((occurrence) => occurrence.id) ?? []);
  const marks = agenda
    ? await all<{ id: string; saved: number; status: string | null }>(
        db,
        "SELECT occurrence_id AS id,COALESCE(saved,0) AS saved,CASE WHEN status IN ('reserved','approval_pending','waitlisted') THEN status END AS status FROM agenda_session_participations WHERE event_id=? AND user_id=? AND (saved=1 OR status IN ('reserved','approval_pending','waitlisted'))",
        [event.id, userId],
      )
    : [];
  return personalAgendaProgramResponseSchema.parse({
    agenda,
    marks: marks.filter((mark) => published.has(mark.id)).map((mark) => ({ ...mark, saved: Boolean(mark.saved) })),
  });
}
