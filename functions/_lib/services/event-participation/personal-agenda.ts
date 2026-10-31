import { personalAvailability, preparePersonalAvailabilitySelection } from "./personal-availability";
import type { ParticipationAvailability } from "../../../../assets/shared/schemas/event-participation-availability";
import { preparePersonalAgendaOverlapSelection } from "./personal-agenda-overlaps";
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
import { all } from "../../db/queries";
import { buildOffsetPageSql, batchFirst, batchRows } from "../../db/pagination";
import { liveStreamDaysSql, sessionLiveStreamRoom } from "./virtual-room";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { D1StatementResult } from "../../types";
import type { DatabaseLike, Env } from "../../types";
import { readParticipantEvent } from "./participant-read-context";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import {
  heldParticipationStatusesSql,
  onPersonalAgendaSql,
  privateSessionAccessSql,
} from "./personal-agenda-membership";
/**
 * A private session reaches a participant only when they hold a place on it
 * (reserved or awaiting approval) or an unrevoked invitation. Expects the
 * session as `s`, the viewer's participation as `p`, and binds the viewer once.
 */

export async function personalAgenda(db: DatabaseLike, eventId: string, userId: string, raw: unknown) {
  const read = preparePersonalAgenda(db, eventId, userId, raw);
  return read.decode(await db.batch(read.statements));
}

export function preparePersonalAgenda(
  db: DatabaseLike,
  eventSelection: EventReadSelection,
  userId: string,
  raw: unknown,
) {
  const event = eventReadIdSql(eventSelection);
  const query = personalAgendaQuerySchema.parse(raw);
  const where = `s.event_id=${event.sql} AND (s.visibility='public' OR ${privateSessionAccessSql}) AND INSTR(LOWER(s.title),LOWER(?))>0 AND (? IS NULL OR p.status=?) AND (? IS NULL OR s.id=?)
    AND (? IS NULL OR s.end_at>?) AND (?=0 OR ${onPersonalAgendaSql("p")})`;
  const bindings = [
    userId,
    ...event.bindings,
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
  const sort =
    query.sort === "title"
      ? "s.title ASC"
      : query.sort === "-title"
        ? "s.title DESC"
        : query.sort === "-startAt"
          ? "s.start_at DESC"
          : "s.start_at ASC";
  const source = { fromSql: `${from} WHERE ${where}`, bindings };
  const orderBy = `ORDER BY ${sort},s.id`;
  const page = buildOffsetPageSql({
    source: {
      ...source,
      selectSql: `SELECT s.id,s.room_id,s.published_revision AS publishedRevision,s.title,EXISTS(SELECT 1 FROM event_agenda_published_occurrences approved JOIN events event ON event.id=approved.event_id WHERE approved.event_id=s.event_id AND approved.revision=s.published_revision AND approved.occurrence_id=s.id AND ${approvedVirtualRoomUrlSql("approved")} IS NOT NULL AND ${approvedVirtualRoomUrlSql("approved")} IS ${draftVirtualRoomUrlSql("approved.occurrence_id", "event.settings_json")}) AS online_access_available,(SELECT json_group_array(json_object('id',location.id,'name',location.name)) FROM (${publishedRoomsSql}) location WHERE location.event_id=s.event_id AND (location.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) selected WHERE selected.value=location.id))) AS rooms_json,s.timezone AS timeZone,s.start_at AS startAt,s.end_at AS endAt,s.admission_policy AS admissionPolicy,s.access_policy AS accessPolicy,EXISTS(SELECT 1 FROM agenda_session_invitations invitation WHERE invitation.occurrence_id=s.id AND invitation.user_id=? AND invitation.revoked_at IS NULL) AS invited,${liveStreamDaysSql("s")} AS live_stream_days,s.visibility,p.status,COALESCE(p.saved,0) AS saved,p.attendance_mode AS attendanceMode`,
      bindings: [userId, userId, ...bindings],
      countBindings: bindings,
    },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const ids = buildOffsetPageSql({
    source: { ...source, selectSql: "SELECT s.id" },
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  const selection = { sql: ids.pageSql, bindings: [...ids.bindings, query.limit, query.offset] };
  const overlaps = preparePersonalAgendaOverlapSelection(db, eventSelection, userId, selection);
  const availability = preparePersonalAvailabilitySelection(db, eventSelection, userId, selection);
  return {
    statements: [
      db.prepare(page.countSql).bind(...page.countBindings),
      db.prepare(page.pageSql).bind(...page.bindings, query.limit, query.offset),
      ...overlaps.statements,
      ...availability.statements,
      db.prepare(`SELECT city FROM events WHERE id=${event.sql}`).bind(...event.bindings),
    ],
    decode(loaded: D1StatementResult[]) {
      const count = batchFirst<{ total: number }>(loaded[0]);
      const sessions = batchRows<Record<string, unknown>>(loaded[1]);
      const overlapGroups = overlaps.decode([loaded[2]]);
      const availabilityGroups = availability.decode([loaded[3]]);
      const event = batchFirst<{ city: string | null }>(loaded[4]);
      const clockCity = eventClockCity(event?.city);
      return personalAgendaResponseSchema.parse({
        sessions: sessions.map((row) => {
          const { rooms_json, online_access_available, live_stream_days, room_id, ...session } = row as Record<
            string,
            unknown
          >;
          return {
            ...session,
            clockCity,
            liveStreamRoomId: sessionLiveStreamRoom(
              {
                roomId: room_id as string | null,
                startAt: session.startAt as string | null,
                timeZone: String(session.timeZone),
              },
              live_stream_days as string | null,
            ),
            saved: Boolean(session.saved),
            invited: Boolean(session.invited),
            onlineAccessAvailable: Boolean(online_access_available),
            ...overlapGroups.get(String(session.id)),
            availability: availabilityGroups.get(String(session.id)) ?? null,
            rooms: JSON.parse(String(rooms_json ?? "[]")),
          };
        }),
        page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, sessions.length),
      });
    },
  };
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
        `SELECT occurrence_id AS id,saved,CASE WHEN status IN (${heldParticipationStatusesSql},'canceled') THEN status END AS status FROM agenda_session_participations p WHERE event_id=? AND user_id=? AND ${onPersonalAgendaSql("p")}`,
        [event.id, userId],
      )
    : [];
  // The admission the session details read, so an agenda card names the same seat action.
  const availability = agenda
    ? await personalAvailability(
        db,
        event.id,
        userId,
        agenda.occurrences
          .filter((occurrence) => occurrence.startAt)
          .map((occurrence) => ({ id: occurrence.id, startAt: occurrence.startAt, timeZone: agenda.timeZone })),
      )
    : new Map<string, ParticipationAvailability>();
  return personalAgendaProgramResponseSchema.parse({
    agenda,
    marks: marks.filter((mark) => published.has(mark.id)).map((mark) => ({ ...mark, saved: Boolean(mark.saved) })),
    availability: [...availability].map(([id, admission]) => ({ id, availability: admission })),
  });
}

/** The attendee home and personal listing share one authenticated resource snapshot. */
export async function readPersonalAgendaRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  slug: string,
  query: unknown,
) {
  return readParticipantEvent(db, request, env, slug, "audience", (userId, event) =>
    preparePersonalAgenda(db, event, userId, query),
  );
}
