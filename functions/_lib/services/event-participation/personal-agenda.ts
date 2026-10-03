import {
  personalAgendaQuerySchema,
  personalAgendaResponseSchema,
} from "../../../../assets/shared/schemas/event-personal-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { publishedSessionsSql } from "./published-schedule";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
export async function personalAgenda(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const query = personalAgendaQuerySchema.parse(raw);
  const where =
    "s.event_id=? AND (s.visibility='public' OR p.status IN ('reserved','approval_pending')) AND INSTR(LOWER(s.title),LOWER(?))>0 AND (? IS NULL OR p.status=?)";
  const bindings = [userId, eventId, query.q ?? "", query.status ?? null, query.status ?? null];
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
    `SELECT s.id,s.title,s.start_at AS startAt,s.end_at AS endAt,s.admission_policy AS admissionPolicy,p.status,p.attendance_mode AS attendanceMode ${from} WHERE ${where} ORDER BY ${sort},s.id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return personalAgendaResponseSchema.parse({
    sessions,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
  });
}
