import { personalAvailability } from "./personal-availability";
import { personalAgendaOverlaps } from "./personal-agenda-overlaps";
import {
  personalAgendaQuerySchema,
  personalAgendaResponseSchema,
} from "../../../../assets/shared/schemas/event-personal-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
export async function personalAgenda(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const query = personalAgendaQuerySchema.parse(raw);
  const where =
    "s.event_id=? AND (s.visibility='public' OR p.status IN ('reserved','approval_pending') OR EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=p.user_id AND invitation.revoked_at IS NULL)) AND INSTR(LOWER(s.title),LOWER(?))>0 AND (? IS NULL OR p.status=?) AND (? IS NULL OR s.id=?)";
  const bindings = [
    userId,
    eventId,
    query.q ?? "",
    query.status ?? null,
    query.status ?? null,
    query.occurrenceId ?? null,
    query.occurrenceId ?? null,
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
    `SELECT s.id,s.published_revision AS publishedRevision,s.title,EXISTS(SELECT 1 FROM event_agenda_published_occurrences approved JOIN events event ON event.id=approved.event_id WHERE approved.event_id=s.event_id AND approved.revision=s.published_revision AND approved.occurrence_id=s.id AND json_extract(approved.payload_json,'$.virtualRoomUrl') IS NOT NULL AND json_extract(approved.payload_json,'$.virtualRoomUrl') IS json_extract(event.settings_json,'$.agenda.sessionMedia.'||json_quote(approved.occurrence_id)||'.joinUrl')) AS online_access_available,p.room_id AS roomId,(SELECT json_group_array(json_object('id',location.id,'name',location.name)) FROM (${publishedRoomsSql}) location WHERE location.event_id=s.event_id AND (location.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) selected WHERE selected.value=location.id))) AS rooms_json,s.timezone AS timeZone,s.start_at AS startAt,s.end_at AS endAt,s.admission_policy AS admissionPolicy,s.visibility,p.status,COALESCE(p.saved,0) AS saved,p.attendance_mode AS attendanceMode ${from} WHERE ${where} ORDER BY ${sort},s.id LIMIT ? OFFSET ?`,
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
