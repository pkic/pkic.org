import { readAgendaSponsorRows, agendaSponsorDisplay } from "./sponsors";
import { agendaSponsorIdsSchema } from "../../../../assets/shared/schemas/event-agenda-sponsors";
import { orderedAgendaRooms } from "./room-order-settings";
import { readAgendaDurationRules } from "../../../../assets/shared/event-agenda-duration";
import { agendaOccurrenceDisplayStartSql, agendaOccurrenceConflictCoverageSql } from "./occurrence-display-timing";
import { getAgendaStaffingReport } from "./staffing-report";
import { agendaOccurrenceConflictSql } from "./occurrence-conflicts";
import {
  agendaConflictCoverageSchema,
  agendaConflictCategorySchema,
} from "../../../../assets/shared/schemas/event-agenda";
import { readAgendaSpeakers } from "./speaker-profiles";
import { agendaPublicationStatusSql } from "./publication-status";
import { readSessionDemand } from "../event-participation/session-demand";
import { promotionCopySchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { sessionHistoryMetadataSchema } from "../../../../assets/shared/schemas/event-session-history";
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
  source_proposal_type: string | null;
  content_id: string | null;
  publication_status: string;
  id: string;
  title: string;
  description: string;
  presentation_url: string | null;
  recording_url: string | null;
  virtual_room_url: string | null;
  virtual_room_type: string | null;
  sponsor_ids_json: string | null;
  public_anchor: string | null;
  start_at: string | null;
  end_at: string | null;
  room_id: string | null;
  required_equipment_json: string;
  admission_policy: string;
  access_policy: string;
  booking_opens_at: string | null;
  booking_closes_at: string | null;
  capacity: number | null;
  remote_capacity: number | null;
  visibility: string;
  kind: string;
  track: string | null;
}
const columns =
  "id,content_id,title,description,presentation_url,recording_url,public_anchor,start_at,end_at,room_id,admission_policy,access_policy,booking_opens_at,booking_closes_at,capacity,remote_capacity,visibility,kind,track,required_equipment_json";
async function occurrences(
  db: DatabaseLike,
  eventId: string,
  where = "",
  values: unknown[] = [],
  suffix = "ORDER BY start_at,id LIMIT 2001",
) {
  const rows = await all<OccurrenceRow>(
    db,
    `SELECT ${columns},json_extract((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionMedia.'||json_quote(id)||'.joinUrl') AS virtual_room_url,json_type((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionMedia.'||json_quote(id)||'.joinUrl') AS virtual_room_type,json_extract((SELECT settings_json FROM events WHERE id=event_agenda_occurrences.event_id),'$.agenda.sessionSponsors.'||json_quote(id)||'.sponsorIds') AS sponsor_ids_json,${agendaPublicationStatusSql} AS publication_status,(SELECT proposal.proposal_type FROM session_proposals proposal WHERE proposal.event_id = event_agenda_occurrences.event_id AND event_agenda_occurrences.source_key = 'proposal:' || proposal.id) AS source_proposal_type FROM event_agenda_occurrences WHERE event_id = ? ${where} ${suffix}`,
    [eventId, ...values],
  );
  const requestedIds = JSON.stringify(rows.map((row) => row.id));
  const speakerGroups = await readAgendaSpeakers(
    db,
    eventId,
    rows.map((row) => row.id),
  );
  const histories = await all<{ occurrence_id: string; metadata_json: string }>(
    db,
    "SELECT h.occurrence_id,h.metadata_json FROM event_agenda_session_history h JOIN event_agenda_occurrences o ON o.id=h.occurrence_id WHERE h.occurrence_id IN(SELECT value FROM json_each(?)) AND o.event_id=? LIMIT 2001",
    [requestedIds, eventId],
  );
  const historyById = new Map(
    histories.map((row) => [row.occurrence_id, sessionHistoryMetadataSchema.parse(JSON.parse(row.metadata_json))]),
  );
  const copies = await all<{ occurrence_id: string; copy_json: string }>(
    db,
    "SELECT p.occurrence_id,p.copy_json FROM event_agenda_promotion_copy p JOIN event_agenda_occurrences o ON o.id=p.occurrence_id WHERE p.occurrence_id IN(SELECT value FROM json_each(?)) AND o.event_id=? LIMIT 2001",
    [requestedIds, eventId],
  );
  const copyById = new Map(
    copies.map((row) => [row.occurrence_id, promotionCopySchema.parse(JSON.parse(row.copy_json))]),
  );
  const additionalRooms = await all<{ occurrence_id: string; room_id: string }>(
    db,
    "SELECT occurrence_id,room_id FROM event_agenda_occurrence_rooms WHERE occurrence_id IN(SELECT value FROM json_each(?)) ORDER BY occurrence_id,room_id LIMIT 38001",
    [requestedIds],
  );
  const roomsByOccurrence = new Map<string, string[]>();
  for (const room of additionalRooms)
    roomsByOccurrence.set(room.occurrence_id, [...(roomsByOccurrence.get(room.occurrence_id) ?? []), room.room_id]);
  const sponsorIdsByOccurrence = new Map(
    rows
      .filter((row) => row.kind === "break" && row.sponsor_ids_json !== null)
      .map((row) => [row.id, agendaSponsorIdsSchema.parse(JSON.parse(row.sponsor_ids_json!))]),
  );
  const sponsorRows = await readAgendaSponsorRows(db, eventId, [
    ...new Set([...sponsorIdsByOccurrence.values()].flat()),
  ]);
  const sponsorsById = new Map(sponsorRows.map((sponsor) => [sponsor.sponsor_id, agendaSponsorDisplay(sponsor)]));
  return rows.map((row) =>
    agendaOccurrenceSchema.parse({
      id: row.id,
      contentId: row.content_id,
      publicationStatus: row.publication_status,
      sourceProposalType: row.source_proposal_type,
      ...(sponsorIdsByOccurrence.has(row.id)
        ? {
            sponsorIds: sponsorIdsByOccurrence.get(row.id),
            sponsors: (sponsorIdsByOccurrence.get(row.id) ?? []).flatMap((id) =>
              sponsorsById.has(id) ? [sponsorsById.get(id)!] : [],
            ),
          }
        : {}),
      history: historyById.get(row.id),
      promotionCopy: copyById.get(row.id),
      title: row.title,
      description: row.description,
      presentationUrl: row.presentation_url,
      recordingUrl: row.recording_url,
      ...(row.virtual_room_type !== null ? { virtualRoomUrl: row.virtual_room_url } : {}),
      publicAnchor: row.public_anchor,
      startAt: row.start_at,
      endAt: row.end_at,
      roomId: row.room_id,
      additionalRoomIds: roomsByOccurrence.get(row.id) ?? [],
      requiredEquipment: JSON.parse(row.required_equipment_json),
      admissionPolicy: row.admission_policy,
      accessPolicy: row.access_policy,
      bookingOpensAt: row.booking_opens_at,
      bookingClosesAt: row.booking_closes_at,
      capacity: row.capacity,
      remoteCapacity: row.remote_capacity,
      visibility: row.visibility,
      kind: row.kind,
      track: row.track,
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
    settings_json: string;
    timezone: string;
    starts_at: string | null;
    ends_at: string | null;
    name: string;
    base_path: string | null;
  }>(db, "SELECT settings_json,timezone,starts_at,ends_at,name,base_path FROM events WHERE id = ?", [eventId]);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const state = await first<{ revision: number; published_revision: number | null; travel_minutes: number }>(
    db,
    "SELECT revision,published_revision,travel_minutes FROM event_agenda_state WHERE event_id = ?",
    [eventId],
  );
  const rooms = await all<{
    id: string;
    name: string;
    capacity: number | null;
    setup_minutes: number;
    equipment_json: string;
    available_periods_json: string;
  }>(
    db,
    "SELECT id,name,capacity,setup_minutes,equipment_json,available_periods_json FROM event_agenda_rooms WHERE event_id = ? ORDER BY name,id LIMIT 200",
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
    track: string | null;
    roles_json: string;
    role_requirements_json: string;
    compatible_roles_json: string;
    boundaries_json: string;
  }>(
    db,
    "SELECT id,name,start_at,end_at,room_id,track,roles_json,role_requirements_json,compatible_roles_json,boundaries_json FROM event_agenda_blocks WHERE event_id = ? ORDER BY start_at,id LIMIT 200",
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
  const staffingRoles = await all<{ id: string; name: string; show_on_agenda: number }>(
    db,
    "SELECT id,name,show_on_agenda FROM event_agenda_staffing_roles WHERE event_id=? ORDER BY id LIMIT 100",
    [eventId],
  );
  const staffingPosts = await all<{ id: string; name: string; roomId: string | null }>(
    db,
    "SELECT id,name,room_id AS roomId FROM event_agenda_staffing_posts WHERE event_id=? ORDER BY id LIMIT 200",
    [eventId],
  );
  const staffingRequirements = await all<{
    id: string;
    blockId: string;
    roleId: string;
    postId: string | null;
    idealCount: number;
    seniority: string;
    attendanceMode: string;
  }>(
    db,
    "SELECT id,block_id AS blockId,role_id AS roleId,post_id AS postId,ideal_count AS idealCount,seniority,attendance_mode AS attendanceMode FROM event_agenda_staffing_requirements WHERE event_id=? ORDER BY id LIMIT 1000",
    [eventId],
  );
  const staffingPositions = await all<{ id: string; requirementId: string; index: number }>(
    db,
    "SELECT id,requirement_id AS requirementId,position_index AS [index] FROM event_agenda_staffing_positions WHERE event_id=? ORDER BY requirement_id,position_index LIMIT 2000",
    [eventId],
  );
  const assignments = await all<{
    position_id: string;
    post_id: string | null;
    block_id: string;
    role: string;
    user_id: string;
    pinned: number;
    origin: "manual" | "generated";
  }>(
    db,
    "SELECT assignment.position_id,assignment.post_id,assignment.block_id,assignment.role,assignment.user_id,assignment.pinned,assignment.origin FROM event_agenda_assignments assignment JOIN event_agenda_blocks block ON block.id=assignment.block_id WHERE block.event_id = ? ORDER BY assignment.position_id LIMIT 2000",
    [eventId],
  );
  const snapshot = agendaSnapshotSchema.parse({
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
    rooms: orderedAgendaRooms(rooms, event.settings_json).map((room) => ({
      ...room,
      setupMinutes: room.setup_minutes,
      equipment: JSON.parse(room.equipment_json),
      availablePeriods: JSON.parse(room.available_periods_json),
    })),
    travelMinutes: state?.travel_minutes ?? 0,
    durationRules: readAgendaDurationRules(event.settings_json),
    occurrences: items,
    blocks: blocks.map((block) => ({
      id: block.id,
      name: block.name,
      startAt: block.start_at,
      endAt: block.end_at,
      roomId: block.room_id,
      track: block.track ?? undefined,
      roles: JSON.parse(block.roles_json),
      roleRequirements: JSON.parse(block.role_requirements_json),
      compatibleRolePairs: JSON.parse(block.compatible_roles_json),
      boundaries: JSON.parse(block.boundaries_json),
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
    staffingRoles: staffingRoles.map((role) => ({ ...role, showOnAgenda: role.show_on_agenda === 1 })),
    staffingPosts,
    staffingRequirements,
    staffingPositions,
    assignments: assignments.map((assignment) => ({
      positionId: assignment.position_id,
      postId: assignment.post_id,
      blockId: assignment.block_id,
      role: assignment.role,
      userId: assignment.user_id,
      pinned: assignment.pinned === 1,
      origin: assignment.origin,
    })),
  });
  return { ...snapshot, staffingReport: await getAgendaStaffingReport(db, eventId, snapshot) };
}
export async function listAgendaOccurrences(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (query.conflict && query.conflict !== "all") {
    const conflict = agendaOccurrenceConflictSql().any;
    conditions.push(
      query.conflict === "conflicted"
        ? conflict
        : query.conflict === "incomplete"
          ? `(${agendaOccurrenceConflictCoverageSql})<>'complete'`
          : `NOT ${conflict} AND (${agendaOccurrenceConflictCoverageSql})='complete'`,
    );
  }
  if (query.q) {
    conditions.push("INSTR(LOWER(title),LOWER(?)) > 0");
    values.push(query.q);
  }
  if (query.roomId) {
    conditions.push(
      "(room_id = ? OR EXISTS(SELECT 1 FROM event_agenda_occurrence_rooms placement WHERE placement.occurrence_id=event_agenda_occurrences.id AND placement.room_id=?))",
    );
    values.push(query.roomId, query.roomId);
  }
  if (query.admissionPolicy) {
    conditions.push("admission_policy = ?");
    values.push(query.admissionPolicy);
  }
  if (query.accessPolicy) {
    conditions.push("access_policy = ?");
    values.push(query.accessPolicy);
  }
  if (query.speakerUserId) {
    conditions.push(
      "EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers speaker WHERE speaker.occurrence_id=event_agenda_occurrences.id AND speaker.user_id=?)",
    );
    values.push(query.speakerUserId);
  }
  if (query.publicationStatus) {
    conditions.push(`(${agendaPublicationStatusSql}) = ?`);
    values.push(query.publicationStatus);
  }
  if (query.visibility) {
    conditions.push("visibility = ?");
    values.push(query.visibility);
  }
  if (query.kind) {
    conditions.push("kind = ?");
    values.push(query.kind);
  }
  if (query.track) {
    conditions.push("track = ?");
    values.push(query.track);
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
    conditions.push(`(${agendaOccurrenceDisplayStartSql}) >= ? AND (${agendaOccurrenceDisplayStartSql}) < ?`);
    values.push(start, end);
  }
  const where = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
  const total = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM event_agenda_occurrences WHERE event_id = ? ${where}`,
    [eventId, ...values],
  );
  const field = query.sort?.replace(/^-/u, "") ?? "startAt";
  const sort =
    { title: "title", startAt: `(${agendaOccurrenceDisplayStartSql})`, endAt: "end_at" }[field] ??
    `(${agendaOccurrenceDisplayStartSql})`;
  const items = await occurrences(
    db,
    eventId,
    where,
    values,
    `ORDER BY ${sort} ${query.sort?.startsWith("-") ? "DESC" : "ASC"},id LIMIT ${query.limit} OFFSET ${query.offset}`,
  );
  const summaries = items.length
    ? await all<Record<string, unknown> & { id: string }>(
        db,
        `SELECT id,(${agendaOccurrenceConflictCoverageSql}) AS coverage,${agendaOccurrenceConflictSql().projection} FROM event_agenda_occurrences WHERE event_id=? AND id IN(SELECT value FROM json_each(?)) LIMIT ?`,
        [eventId, JSON.stringify(items.map((item) => item.id)), query.limit],
      )
    : [];
  const byId = new Map(summaries.map((row) => [row.id, row]));
  const demandById = await readSessionDemand(
    db,
    eventId,
    items.map((item) => item.id),
  );
  const listed = items.map((item) => {
    const row = byId.get(item.id);
    const categories = agendaConflictCategorySchema.options.filter((category) => Boolean(row?.[category]));
    return {
      ...item,
      demand: demandById.get(item.id)!,
      conflicts: {
        hasConflict: categories.length > 0,
        categories,
        coverage: agendaConflictCoverageSchema.parse(row?.coverage ?? "not_scheduled"),
      },
    };
  });
  return { occurrences: listed, page: buildPageInfo(query.limit, query.offset, total?.total ?? 0, listed.length) };
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
