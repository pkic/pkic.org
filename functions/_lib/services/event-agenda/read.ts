import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import { z } from "zod";
import {
  agendaSnapshotSchema,
  agendaOccurrenceSchema,
  agendaOccurrenceQuerySchema,
} from "../../../../assets/shared/schemas/event-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";

interface OccurrenceRow {
  id: string;
  title: string;
  description: string;
  presentation_url: string | null;
  recording_url: string | null;
  start_at: string | null;
  end_at: string | null;
  room_id: string | null;
  admission_policy: string;
  capacity: number | null;
  remote_capacity: number | null;
  visibility: string;
  kind: string;
}
const columns =
  "id,title,description,presentation_url,recording_url,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility,kind";
async function occurrences(
  db: DatabaseLike,
  eventId: string,
  where = "",
  values: unknown[] = [],
  suffix = "ORDER BY start_at,id LIMIT 2001",
) {
  const rows = await all<OccurrenceRow>(
    db,
    `SELECT ${columns} FROM event_agenda_occurrences WHERE event_id = ? ${where} ${suffix}`,
    [eventId, ...values],
  );
  const speakers = rows.length
    ? await all<{ occurrence_id: string; user_id: string; display_name: string }>(
        db,
        `SELECT speaker.occurrence_id,speaker.user_id,COALESCE(NULLIF(user.preferred_name,''),NULLIF(TRIM(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'')),''),'Speaker') AS display_name FROM event_agenda_occurrence_speakers speaker JOIN users user ON user.id=speaker.user_id JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id = ? LIMIT 60000`,
        [eventId],
      )
    : [];
  const speakerGroups = new Map<string, Array<{ userId: string; displayName: string }>>();
  for (const speaker of speakers) {
    const group = speakerGroups.get(speaker.occurrence_id) ?? [];
    group.push({ userId: speaker.user_id, displayName: speaker.display_name });
    speakerGroups.set(speaker.occurrence_id, group);
  }
  return rows.map((row) =>
    agendaOccurrenceSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      presentationUrl: row.presentation_url,
      recordingUrl: row.recording_url,
      startAt: row.start_at,
      endAt: row.end_at,
      roomId: row.room_id,
      admissionPolicy: row.admission_policy,
      capacity: row.capacity,
      remoteCapacity: row.remote_capacity,
      visibility: row.visibility,
      kind: row.kind,
      speakers: speakerGroups.get(row.id) ?? [],
    }),
  );
}
export async function getAgendaOccurrence(db: DatabaseLike, eventId: string, id: string) {
  const result = await occurrences(db, eventId, "AND id = ?", [id], "LIMIT 1");
  if (!result[0]) throw new AppError(404, "AGENDA_OCCURRENCE_NOT_FOUND", "Session not found");
  return result[0];
}
export async function getAgenda(db: DatabaseLike, eventId: string, eventSlug: string) {
  const event = await first<{
    timezone: string;
    starts_at: string | null;
    ends_at: string | null;
    name: string;
    base_path: string | null;
  }>(db, "SELECT timezone,starts_at,ends_at,name,base_path FROM events WHERE id = ?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const state = await first<{ revision: number; published_revision: number | null; travel_minutes: number }>(
    db,
    "SELECT revision,published_revision,travel_minutes FROM event_agenda_state WHERE event_id = ?",
    [eventId],
  );
  const rooms = await all<{ id: string; name: string; capacity: number | null; setup_minutes: number }>(
    db,
    "SELECT id,name,capacity,setup_minutes FROM event_agenda_rooms WHERE event_id = ? ORDER BY name LIMIT 200",
    [eventId],
  );
  const items = await occurrences(db, eventId);
  if (items.length > 2000)
    throw new AppError(422, "AGENDA_TOO_LARGE", "Agenda exceeds the 2,000 occurrence editing limit");
  const blocks = await all<{
    id: string;
    name: string;
    start_at: string;
    end_at: string;
    room_id: string | null;
    roles_json: string;
    role_requirements_json: string;
  }>(
    db,
    "SELECT id,name,start_at,end_at,room_id,roles_json,role_requirements_json FROM event_agenda_blocks WHERE event_id = ? ORDER BY start_at,id LIMIT 200",
    [eventId],
  );
  const members = await all<{
    user_id: string;
    display_name: string;
    roles_json: string;
    available_from: string | null;
    available_until: string | null;
    max_minutes: number | null;
    seniority: string;
    attendance_mode: string;
  }>(
    db,
    "SELECT member.user_id,COALESCE(user.preferred_name,user.first_name,'Staff') AS display_name,member.roles_json,member.available_from,member.available_until,member.max_minutes,member.seniority,member.attendance_mode FROM event_agenda_role_members member JOIN users user ON user.id=member.user_id WHERE member.event_id = ? LIMIT 200",
    [eventId],
  );
  const assignments = await all<{ block_id: string; role: string; user_id: string; pinned: number }>(
    db,
    "SELECT assignment.block_id,assignment.role,assignment.user_id,assignment.pinned FROM event_agenda_assignments assignment JOIN event_agenda_blocks block ON block.id=assignment.block_id WHERE block.event_id = ? LIMIT 1000",
    [eventId],
  );
  return agendaSnapshotSchema.parse({
    eventSlug,
    eventName: event.name,
    publicAgendaPath:
      (event.base_path?.startsWith("/") && !event.base_path.startsWith("//")
        ? event.base_path.replace(/\/$/u, "")
        : `/events/${eventSlug}`) + "/agenda/",
    timeZone: event.timezone,
    eventStartsAt: event.starts_at,
    eventEndsAt: event.ends_at,
    revision: state?.revision ?? 0,
    publishedRevision: state?.published_revision ?? null,
    rooms: rooms.map((room) => ({ ...room, setupMinutes: room.setup_minutes })),
    travelMinutes: state?.travel_minutes ?? 0,
    occurrences: items,
    blocks: blocks.map((block) => ({
      id: block.id,
      name: block.name,
      startAt: block.start_at,
      endAt: block.end_at,
      roomId: block.room_id,
      roles: JSON.parse(block.roles_json),
      roleRequirements: JSON.parse(block.role_requirements_json),
    })),
    roleMembers: members.map((member) => ({
      userId: member.user_id,
      displayName: member.display_name,
      roles: JSON.parse(member.roles_json),
      availableFrom: member.available_from,
      availableUntil: member.available_until,
      maxMinutes: member.max_minutes,
      seniority: member.seniority,
      attendanceMode: member.attendance_mode,
    })),
    assignments: assignments.map((assignment) => ({
      blockId: assignment.block_id,
      role: assignment.role,
      userId: assignment.user_id,
      pinned: assignment.pinned === 1,
    })),
  });
}
export async function listAgendaOccurrences(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.q) {
    conditions.push("INSTR(LOWER(title),LOWER(?)) > 0");
    values.push(query.q);
  }
  if (query.roomId) {
    conditions.push("room_id = ?");
    values.push(query.roomId);
  }
  if (query.admissionPolicy) {
    conditions.push("admission_policy = ?");
    values.push(query.admissionPolicy);
  }
  if (query.day) {
    const event = await first<{ timezone: string }>(db, "SELECT timezone FROM events WHERE id=?", [eventId]);
    if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
    const [year, month, day] = query.day.split("-").map(Number);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const start = zonedDateTimeToDate(
      { year, month, day, hour: 0, minute: 0, second: 0 },
      event.timezone,
    ).toISOString();
    const end = zonedDateTimeToDate(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      event.timezone,
    ).toISOString();
    conditions.push("start_at >= ? AND start_at < ?");
    values.push(start, end);
  }
  const where = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
  const total = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM event_agenda_occurrences WHERE event_id = ? ${where}`,
    [eventId, ...values],
  );
  const field = query.sort?.replace(/^-/u, "") ?? "startAt";
  const sort = { title: "title", startAt: "start_at", endAt: "end_at" }[field] ?? "start_at";
  const items = await occurrences(
    db,
    eventId,
    where,
    values,
    `ORDER BY ${sort} ${query.sort?.startsWith("-") ? "DESC" : "ASC"},id LIMIT ${query.limit} OFFSET ${query.offset}`,
  );
  return { occurrences: items, page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, items.length) };
}

export async function listAgendaPeople(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof import("../../../../assets/shared/schemas/event-agenda").agendaPeopleQuerySchema>,
) {
  const membership =
    "(EXISTS(SELECT 1 FROM proposal_speakers speaker JOIN session_proposals proposal ON proposal.id=speaker.proposal_id WHERE speaker.user_id=user.id AND proposal.event_id=?) OR EXISTS(SELECT 1 FROM user_roles role WHERE role.user_id=user.id AND role.context_type='event' AND role.context_id=? AND role.revoked_at IS NULL AND (role.expires_at IS NULL OR role.expires_at > ?)))";
  const search = query.q
    ? "AND INSTR(LOWER(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'') || ' ' || COALESCE(user.preferred_name,'')),LOWER(?)) > 0"
    : "";
  const values: unknown[] = [eventId, eventId, nowIso(), ...(query.q ? [query.q] : [])];
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM users user WHERE user.active=1 AND ${membership} ${search}`,
    values,
  );
  const users = await all<{ id: string; first_name: string | null; last_name: string | null }>(
    db,
    `SELECT user.id,user.first_name,user.last_name FROM users user WHERE user.active=1 AND ${membership} ${search} ORDER BY user.first_name,user.last_name,user.id LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return {
    users: users.map((user) => ({ ...user, email: "" })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, users.length),
  };
}
