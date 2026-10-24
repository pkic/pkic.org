import { agendaPublicationStatusSql } from "./publication-status";
import {
  readAgendaOccurrences,
  prepareAgendaOccurrenceRows,
  prepareAgendaOccurrenceDetails,
  decodeAgendaOccurrences,
  type OccurrenceRow,
} from "./occurrence-read";
import { prepareAgendaSpeakers, decodeAgendaSpeakers, type AgendaSpeakerRow } from "./speaker-profiles";
import { prepareAgendaSponsorRead, type AgendaSponsorRow } from "./sponsors";
import { prepareAgendaEditorRead } from "./editor-read";
import { publicUserHeadshotPath } from "../user-headshot";
import { affiliationJobTitleSql, affiliationOrganizationNameSql } from "../identities/affiliation-projection";
import { orderedAgendaRooms } from "./room-order-settings";
import { readAgendaDurationRules } from "../../../../assets/shared/event-agenda-duration";
import { agendaOccurrenceDisplayStartSql, agendaOccurrenceConflictCoverageSql } from "./occurrence-display-timing";
import { buildAgendaStaffingReport } from "./staffing-report";
import { agendaOccurrenceConflictSql } from "./occurrence-conflicts";
import {
  agendaConflictCoverageSchema,
  agendaConflictCategorySchema,
} from "../../../../assets/shared/schemas/event-agenda";
import { retainedSpeakerOrganizations } from "../../../../assets/shared/agenda-speaker-affiliations";
import { prepareSessionDemand } from "../event-participation/session-demand";
import { zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import { z } from "zod";
import { agendaSnapshotSchema, agendaOccurrenceQuerySchema } from "../../../../assets/shared/schemas/event-agenda";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { D1StatementResult, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { agendaSessionFormatOptions } from "../../../../assets/shared/event-agenda-format";
import { resolveEventSessionTypes } from "../event-presentation";
import { eventClockCity } from "../../../../assets/shared/event-clock";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readEventAdminResource, readEventAdminContext } from "../events/authorized-context";
import type { Env } from "../../types";
import { requirePermission } from "../../auth/permissions";
import { batchFirst, batchRows, buildOffsetPageSql } from "../../db/pagination";

export async function getAgendaOccurrence(db: DatabaseLike, eventId: string, id: string) {
  const result = await readAgendaOccurrences(db, eventId, "AND id = ?", [id], "LIMIT 1");
  if (!result[0]) throw new AppError(404, "AGENDA_OCCURRENCE_NOT_FOUND", "Session not found");
  return result[0];
}
/** Prepare the complete canonical response so command boundaries can append it to their atomic batch. */
export function prepareAgendaRead(db: DatabaseLike, eventId: EventReadSelection, eventSlug: string) {
  const read = prepareAgendaEditorRead(db, eventId);
  const prepared = {
    statements: read.statements,
    decodeWithEvent(results: D1StatementResult[]) {
      const { snapshotRows, items, organizations, unavailable } = read.decode(results);
      const {
        event,
        state,
        rooms,
        shifts,
        members,
        staffingRoles,
        staffingPosts,
        staffingRequirements,
        staffingPositions,
        assignments,
      } = snapshotRows;
      if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
      if (items.length > 2000)
        throw new AppError(422, "AGENDA_TOO_LARGE", "Agenda exceeds the 2,000 occurrence editing limit");
      const snapshot = agendaSnapshotSchema.parse({
        eventSlug,
        eventName: event.name,
        publicAgendaPath:
          (event.base_path?.startsWith("/") && !event.base_path.startsWith("//")
            ? event.base_path.replace(/\/$/u, "")
            : `/events/${eventSlug}`) + "/agenda/",
        timeZone: event.timezone,
        clockCity: eventClockCity(event.city),
        formats: agendaSessionFormatOptions(resolveEventSessionTypes(event.settings_json).slice(0, 20)),
        eventStartsAt: event.starts_at,
        eventEndsAt: event.ends_at,
        revision: state?.revision ?? 0,
        publishedRevision: state?.published_revision ?? null,
        rooms: orderedAgendaRooms(rooms, event.settings_json).map((room) => ({
          ...room,
          setupMinutes: room.setup_minutes,
          equipment: JSON.parse(room.equipment_json),
          availablePeriods: JSON.parse(room.available_periods_json),
          ...(room.virtual_room_url !== null ? { virtualRoomUrl: room.virtual_room_url } : {}),
        })),
        travelMinutes: state?.travel_minutes ?? 0,
        durationRules: readAgendaDurationRules(event.settings_json),
        occurrences: items,
        shifts: shifts.map((shift) => ({
          id: shift.id,
          name: shift.name,
          startAt: shift.start_at,
          endAt: shift.end_at,
          roomId: shift.room_id,
          track: shift.track ?? undefined,
          roles: JSON.parse(shift.roles_json),
          roleRequirements: JSON.parse(shift.role_requirements_json),
          compatibleRolePairs: JSON.parse(shift.compatible_roles_json),
          boundaries: JSON.parse(shift.boundaries_json),
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
          shiftId: assignment.shift_id,
          role: assignment.role,
          userId: assignment.user_id,
          pinned: assignment.pinned === 1,
          origin: assignment.origin,
        })),
      });
      return {
        event,
        snapshot: {
          ...snapshot,
          speakerOrganizations: retainedSpeakerOrganizations(organizations, snapshot.occurrences),
          staffingReport: buildAgendaStaffingReport(snapshot, unavailable),
        },
      };
    },
    decode: (results: D1StatementResult[]) => prepared.decodeWithEvent(results).snapshot,
  };
  return prepared;
}

export async function getAgenda(db: DatabaseLike, eventId: string, eventSlug: string) {
  const read = prepareAgendaRead(db, eventId, eventSlug);
  return read.decode(await db.batch(read.statements));
}

export async function readAgendaRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:read", (event) =>
    prepareAgendaRead(db, event, eventSlug),
  );
}

export async function listAgendaOccurrences(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  const event = query.day
    ? await first<{ timezone: string }>(db, "SELECT timezone FROM events WHERE id=?", [eventId])
    : null;
  if (query.day && !event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const read = prepareAgendaOccurrenceList(db, eventId, query, event?.timezone);
  return read.decode(await db.batch(read.statements));
}

function prepareAgendaOccurrenceList(
  db: DatabaseLike,
  eventId: EventReadSelection,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
  timeZone?: string,
) {
  const scope = eventReadIdSql(eventId);
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
    if (!timeZone) throw new Error("Agenda day selection requires the owning event's time zone");
    const [year, month, day] = query.day.split("-").map(Number);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
    const start = zonedDateTimeToDate({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone).toISOString();
    const end = zonedDateTimeToDate(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      },
      timeZone,
    ).toISOString();
    conditions.push(`(${agendaOccurrenceDisplayStartSql}) >= ? AND (${agendaOccurrenceDisplayStartSql}) < ?`);
    values.push(start, end);
  }
  const where = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
  const field = query.sort?.replace(/^-/u, "") ?? "startAt";
  const sort =
    { title: "title", startAt: `(${agendaOccurrenceDisplayStartSql})`, endAt: "end_at" }[field] ??
    `(${agendaOccurrenceDisplayStartSql})`;
  const suffix = `ORDER BY ${sort} ${query.sort?.startsWith("-") ? "DESC" : "ASC"},id LIMIT ${query.limit} OFFSET ${query.offset}`;
  const page = buildOffsetPageSql({
    source: {
      selectSql: "SELECT id",
      fromSql: `FROM event_agenda_occurrences WHERE event_id=${scope.sql} ${where}`,
      bindings: [...scope.bindings, ...values],
    },
    orderBy: `ORDER BY ${sort} ${query.sort?.startsWith("-") ? "DESC" : "ASC"},id`,
    limit: query.limit,
    offset: query.offset,
  });
  const selection = { sql: page.pageSql, bindings: [...page.bindings, query.limit, query.offset] };
  const details = prepareAgendaOccurrenceDetails(db, eventId, selection);
  const demand = prepareSessionDemand(db, eventId, selection);
  return {
    statements: [
      db.prepare(page.countSql).bind(...page.countBindings),
      prepareAgendaOccurrenceRows(db, eventId, where, values, suffix),
      prepareAgendaSpeakers(db, eventId, selection),
      ...details,
      prepareAgendaSponsorRead(db, eventId, undefined, selection),
      db
        .prepare(
          `SELECT id,(${agendaOccurrenceConflictCoverageSql}) AS coverage,${agendaOccurrenceConflictSql().projection} FROM event_agenda_occurrences WHERE event_id=${scope.sql} AND id IN(${selection.sql}) LIMIT ?`,
        )
        .bind(...scope.bindings, ...selection.bindings, query.limit),
      ...demand.statements,
    ],
    decode(results: D1StatementResult[]) {
      const total = batchFirst<{ total: number }>(results[0]);
      const items = decodeAgendaOccurrences(
        batchRows<OccurrenceRow>(results[1]),
        decodeAgendaSpeakers(batchRows<AgendaSpeakerRow>(results[2])),
        results.slice(3, 6),
        batchRows<AgendaSponsorRow>(results[6]),
      );
      const summaries = batchRows<Record<string, unknown> & { id: string }>(results[7]);
      const byId = new Map(summaries.map((row) => [row.id, row]));
      const demandById = demand.decode(
        results.slice(8),
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
    },
  };
}

export async function readAgendaOccurrencesRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: z.infer<typeof agendaOccurrenceQuerySchema>,
) {
  if (query.day) {
    // UTC day bounds depend on the persisted IANA zone; keep that conversion in the shared codec.
    const { actor, event } = await readEventAdminContext(db, request, env, eventSlug);
    requirePermission(actor, "agenda:read", { type: "event", id: event.id });
    const read = prepareAgendaOccurrenceList(db, event.id, query, event.timezone);
    return read.decode(await db.batch(read.statements));
  }
  return readEventAdminResource(db, request, env, eventSlug, "agenda:read", (event) =>
    prepareAgendaOccurrenceList(db, event, query),
  );
}

export async function listAgendaPeople(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof import("../../../../assets/shared/schemas/event-agenda").agendaPeopleQuerySchema>,
) {
  // Imported and manually credited speakers may have no proposal or event role.
  const membership = `(EXISTS(SELECT 1 FROM proposal_speakers speaker JOIN session_proposals proposal ON proposal.id=speaker.proposal_id WHERE speaker.user_id=user.id AND proposal.event_id=?)
    OR EXISTS(SELECT 1 FROM user_roles role WHERE role.user_id=user.id AND role.context_type='event' AND role.context_id=? AND role.revoked_at IS NULL AND (role.expires_at IS NULL OR role.expires_at > ?))
    OR user.id IN (
      SELECT speaker.user_id FROM event_agenda_occurrence_speakers speaker JOIN event_agenda_occurrences occurrence ON occurrence.id=speaker.occurrence_id WHERE occurrence.event_id=?
    ))`;
  const eligible = `user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL AND ${membership}`;
  const search = query.q
    ? "AND INSTR(LOWER(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'') || ' ' || COALESCE(user.preferred_name,'')),LOWER(?)) > 0"
    : "";
  const values: unknown[] = [eventId, eventId, nowIso(), eventId, ...(query.q ? [query.q] : [])];
  const count = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM users user WHERE ${eligible} ${search}`,
    values,
  );
  const users = await all<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    headshot_r2_key: string | null;
  }>(
    db,
    `SELECT user.id,user.first_name,user.last_name,user.headshot_r2_key, ${affiliationOrganizationNameSql("user.id")} AS organization_name, ${affiliationJobTitleSql("user.id")} AS job_title FROM users user WHERE ${eligible} ${search} ORDER BY user.first_name,user.last_name,user.id LIMIT ? OFFSET ?`,
    [...values, query.limit, query.offset],
  );
  return {
    users: users.map(({ headshot_r2_key, ...user }) => ({
      ...user,
      email: "",
      headshotUrl: publicUserHeadshotPath(user.id, headshot_r2_key),
    })),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, users.length),
  };
}
