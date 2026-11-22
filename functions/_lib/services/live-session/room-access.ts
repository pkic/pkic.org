import {
  currentLiveRoomCommandRead,
  liveParticipantReadKey,
  liveRoomAccessScopeKey,
  type LiveParticipantReadResult,
  type LiveRoomAccessScope,
} from "./room-command-read-scope";
import { prepareLiveLocationChatRead, type LiveLocationChatRow } from "./location-chat-read";
import { connectedSessionClaims } from "../../auth/user-session-activity";
import { prepareUserSessionClaimsBatch } from "../../auth/user-session-live-data";
import type { LiveRoomRole } from "../../../../assets/shared/live-session-policy";
import { liveRoomOutputs } from "../../../../assets/shared/live-room-outputs";
import { LIVE_OVERLAY_PROTOCOL_PREFIX } from "../../../../assets/shared/schemas/live-session-room";
import { verifyLiveOverlayToken } from "../../auth/live-session-overlay-token";
import { hasPermission } from "../../auth/permissions";
import { resolveUserSessionContext } from "../../auth/user-session";
import type { UserSessionResult } from "../../auth/user-session-result";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { getUserSessionToken } from "../../auth/user-session-token";
import { batchFirst, batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
import type { D1StatementResult, DatabaseLike, Env } from "../../types";
import { personDisplayNameSql } from "../people/person-name-sql";
import { publishedSessionsSql } from "../event-participation/published-schedule";
import { sessionAccessEligibleSql } from "../event-participation/session-access";
import { getEventBySlug } from "../events";
import { liveProgramName } from "./room-program";
import { parseJsonSafe } from "../../utils/json";
import { publicUserHeadshotPath } from "../user-headshot";
import {
  readLiveRoomSession,
  prepareLiveRoomSessionRead,
  type LiveRoomSessionRecord,
  type LiveRoomSessionRow,
} from "./room-session";
import type { LiveRoomParticipant } from "./room-admission";
import { livePersonHeadshotSql } from "./live-person-photo";
import type { LiveOverlayView } from "../../../../assets/shared/schemas/live-session-room";

export interface LiveRoomAdmission extends LiveRoomSessionRecord {
  participant: LiveRoomParticipant;
}

/** The overlay token a browser source offers as its second WebSocket subprotocol. */
export function offeredOverlayToken(request: Request): string | null {
  const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
  const entry = offered.find((value) => value.startsWith(LIVE_OVERLAY_PROTOCOL_PREFIX));
  return entry ? entry.slice(LIVE_OVERLAY_PROTOCOL_PREFIX.length) : null;
}

/** The person behind a socket, as the room names and pictures them, and the room's sessions they may attend. */
interface LiveRoomPerson {
  name: string;
  /** JSON array of the candidate sessions the person holds a registration and access for. */
  attendee_sessions: string | null;
  headshot_r2_key: string | null;
}

/** The sessions a people read checks access to: a session's room names its own, a location's chat its location's. */
type LiveRoomPeopleSessions = { occurrenceIds: readonly string[] } | { roomId: string };

/** Who may join a room: its event, the sessions whose access admits an attendee, and who speaks in them. */
export type LiveRoomAccessRecord = {
  eventId: string;
  occurrenceIds: string[];
} & (
  | { speakerUserIds: readonly string[]; speakersByOccurrence?: never }
  | { speakerUserIds?: never; speakersByOccurrence: ReadonlyMap<string, readonly string[]> }
);

function sessionAccess(record: LiveRoomSessionRecord): LiveRoomAccessRecord {
  return {
    eventId: record.eventId,
    occurrenceIds: [record.session.occurrenceId],
    speakerUserIds: record.speakerUserIds,
  };
}

/**
 * One person projection is shared by socket admission and command revalidation. A person attends when they
 * hold a registration and access to any of the room's sessions: one for a session's room, the day's for a
 * location's chat.
 */
function prepareLiveRoomPeople(
  db: DatabaseLike,
  eventId: string,
  sessions: LiveRoomPeopleSessions,
  userIds: readonly string[],
) {
  const candidate =
    "roomId" in sessions
      ? "(access_session.room_id=?1 OR EXISTS(SELECT 1 FROM json_each(access_session.additional_room_ids_json) extra WHERE extra.value=?1))"
      : "access_session.id IN(SELECT value FROM json_each(?1))";
  return db
    .prepare(`SELECT person.id, ${personDisplayNameSql("person", "Attendee")} AS name, ${livePersonHeadshotSql("person")} AS headshot_r2_key,
      (SELECT json_group_array(access_session.id) FROM (${publishedSessionsSql}) access_session
        WHERE access_session.event_id=?2 AND ${candidate}
          AND EXISTS(SELECT 1 FROM registrations registration WHERE registration.event_id=access_session.event_id AND registration.user_id=person.id AND registration.status='registered')
          AND ${sessionAccessEligibleSql("access_session", "person.id", null, false)}) AS attendee_sessions
     FROM users person JOIN json_each(?3) requested ON requested.value=person.id WHERE person.active=1`)
    .bind(
      "roomId" in sessions ? sessions.roomId : JSON.stringify(sessions.occurrenceIds),
      eventId,
      JSON.stringify(userIds),
    );
}

function attendeeOccurrences(person: LiveRoomPerson): ReadonlySet<string> {
  const attended = parseJsonSafe<unknown>(person.attendee_sessions, []);
  return new Set(Array.isArray(attended) ? attended.filter((id): id is string => typeof id === "string") : []);
}

/** The signed-in caller as an operator, a credited speaker or an attendee with access to the room's sessions. */
export async function signedInLiveParticipant(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  record: LiveRoomAccessRecord,
): Promise<LiveRoomParticipant> {
  if (!getUserSessionToken(request)) throw new AppError(401, "AUTH_REQUIRED", "Sign in to join this session.");
  const { session, claims } = await resolveUserSessionContext(db, request, env);
  return participantFromSession(db, session, claims, record);
}

async function participantFromSession(
  db: DatabaseLike,
  session: UserSessionResult,
  claims: UserSessionTokenClaims,
  record: LiveRoomAccessRecord,
  currentPerson?: LiveRoomPerson | null,
): Promise<LiveRoomParticipant> {
  const userId = session.identity.id;
  const person =
    currentPerson !== undefined
      ? currentPerson
      : await prepareLiveRoomPeople(db, record.eventId, { occurrenceIds: record.occurrenceIds }, [
          userId,
        ]).first<LiveRoomPerson>();
  if (!person) throw new AppError(401, "AUTH_REQUIRED", "Sign in again to join this session.");
  // Operating the room is a staff capacity: the event team moderates it, and organizers also run the studio.
  const scope = { type: "event", id: record.eventId } as const;
  const studio = session.staff !== undefined && hasPermission(session.staff, "agenda:live_studio", scope);
  const operator =
    studio || (session.staff !== undefined && hasPermission(session.staff, "agenda:live_moderate", scope));
  const attended = attendeeOccurrences(person);
  const speaks = (id: string) =>
    (record.speakersByOccurrence?.get(id) ?? record.speakerUserIds)?.includes(userId) ?? false;
  const locationOccurrenceIds = record.speakersByOccurrence
    ? record.occurrenceIds.filter((id) => operator || attended.has(id) || speaks(id))
    : undefined;
  const role: LiveRoomRole | null = operator
    ? "operator"
    : record.occurrenceIds.some(speaks)
      ? "speaker"
      : record.occurrenceIds.some((id) => attended.has(id))
        ? "attendee"
        : null;
  if (!role)
    throw new AppError(
      403,
      "LIVE_SESSION_ACCESS_REQUIRED",
      "A confirmed event registration and access to this session are required to join its questions.",
    );
  // Restricting people from chat is the organizers' call, as their other event-wide decisions are.
  const organizer = operator && hasPermission(session.staff!, "events:manage", scope);
  return {
    role,
    ...(studio ? { studio } : {}),
    ...(locationOccurrenceIds ? { locationOccurrenceIds } : {}),
    userId,
    name: person.name,
    organizer,
    photoUrl: publicUserHeadshotPath(userId, person.headshot_r2_key),
    actingIdentityId: session.actingIdentityId,
    sessionClaims: claims,
  };
}

/**
 * Admits one socket to a session's live room: an overlay by its signed access
 * for exactly this room, everyone else by their own signed-in session as an
 * operator, a credited speaker, or a registered attendee with access to it.
 */
export async function admitLiveRoomParticipant(
  db: DatabaseLike,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET" | "LIVE_SESSION_ROOMS">,
  request: Request,
  params: { eventSlug: string; occurrenceId: string; output?: LiveOverlayView },
): Promise<LiveRoomAdmission> {
  const event = await getEventBySlug(db, params.eventSlug);
  const record = await readLiveRoomSession(db, event.id, params.occurrenceId, { people: true });
  const overlayToken = offeredOverlayToken(request);
  if (overlayToken !== null) {
    const access = await verifyLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, overlayToken, {
      eventId: event.id,
    });
    if (!access || !record.roomIds.includes(access.room))
      throw new AppError(401, "LIVE_OVERLAY_ACCESS_INVALID", "This overlay link is invalid or expired.");
    // A link to a screen the room no longer sets up shows nothing, rather than a screen no one controls.
    if (params.output && !liveOverlayViewDrawn(record.session, params.output))
      throw new AppError(400, "LIVE_ROOM_INVALID_OUTPUT", "This output is not one this room draws.");
    if (!env.LIVE_SESSION_ROOMS) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
    const selection = await env.LIVE_SESSION_ROOMS.getByName(liveProgramName(event.id, access.room)).readProgram(
      event.id,
      access.room,
    );
    if (selection.occurrenceId !== params.occurrenceId)
      throw new AppError(
        409,
        "LIVE_PROGRAM_SELECTION_CHANGED",
        "This is no longer the active session in this physical room.",
      );
    return {
      ...record,
      participant: {
        role: "overlay",
        userId: null,
        name: null,
        overlayRoomId: access.room,
        overlayExpiresAt: access.exp,
        ...(params.output ? { overlayOutput: params.output } : {}),
      },
    };
  }
  return { ...record, participant: await signedInLiveParticipant(db, request, env, sessionAccess(record)) };
}

/** Single commands use the same bounded live policy and read batch as broadcast revalidation. */
export async function revalidateLiveRoomParticipant(
  db: DatabaseLike,
  participant: LiveRoomParticipant,
  scope: LiveRoomAccessScope,
  rooms?: Env["LIVE_SESSION_ROOMS"],
): Promise<LiveRoomParticipant> {
  const [current] = await revalidateLiveRoomParticipants(db, [participant], scope, rooms);
  if (!current.ok) throw current.error;
  return current.participant;
}

/** Prepare one bounded recipient chunk for composition with a command's other live reads. */
export function prepareLiveRoomParticipants(
  db: DatabaseLike,
  slice: readonly LiveRoomParticipant[],
  scope: LiveRoomAccessScope,
  rooms?: Env["LIVE_SESSION_ROOMS"],
) {
  const { eventId } = scope;
  // A session's overlays follow the studio's selection; a location's chat has none.
  const occurrenceId = "session" in scope ? scope.session.occurrenceId : null;
  const valid = slice.filter((p) => p.role !== "overlay" && p.sessionClaims && p.sessionClaims.sub === p.userId);
  const claims = valid.map((p) => connectedSessionClaims(p.sessionClaims!));
  const roomRead = prepareLiveRoomAccessRead(db, scope);
  const sessionRead = prepareUserSessionClaimsBatch(db, claims);
  const statements = [
    roomRead.statement,
    ...sessionRead.statements,
    prepareLiveRoomPeople(
      db,
      eventId,
      "session" in scope ? { occurrenceIds: [scope.session.occurrenceId] } : { roomId: scope.location.roomId },
      [...new Set(valid.map((p) => p.userId!))],
    ),
  ];
  return {
    statements,
    async decode(loaded: D1StatementResult[]): Promise<LiveParticipantReadResult[]> {
      const results: LiveParticipantReadResult[] = [];
      const { access: record, roomIds } = await roomRead.decode(loaded[0]);
      const sessions = await sessionRead.decode(loaded.slice(1, 1 + sessionRead.statements.length));
      const people = batchRows<LiveRoomPerson & { id: string }>(loaded[loaded.length - 1]);
      const physicalRooms = [
        ...new Set(
          slice
            .filter((p) => p.role === "overlay" && p.overlayRoomId && roomIds.includes(p.overlayRoomId))
            .map((p) => p.overlayRoomId!),
        ),
      ];
      if (physicalRooms.length && !rooms)
        throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
      const programSelections = new Map(
        await Promise.all(
          physicalRooms.map(
            async (roomId) =>
              [
                roomId,
                (await rooms!.getByName(liveProgramName(eventId, roomId)).readProgram(eventId, roomId)).occurrenceId,
              ] as const,
          ),
        ),
      );
      const peopleById = new Map(people.map((person) => [person.id, person]));
      let currentIndex = 0;
      for (const participant of slice) {
        if (participant.role === "overlay") {
          const refused =
            !participant.overlayRoomId ||
            participant.overlayExpiresAt === undefined ||
            (participant.overlayExpiresAt !== undefined && participant.overlayExpiresAt <= Date.now() / 1000) ||
            (participant.overlayRoomId && !roomIds.includes(participant.overlayRoomId));
          const inactive =
            participant.overlayRoomId && programSelections.get(participant.overlayRoomId) !== occurrenceId;
          results.push(
            inactive
              ? {
                  ok: false,
                  error: new AppError(
                    403,
                    "LIVE_PROGRAM_SELECTION_CHANGED",
                    "This source follows another active session now.",
                  ),
                }
              : refused
                ? {
                    ok: false,
                    error: new AppError(
                      401,
                      "LIVE_OVERLAY_ACCESS_INVALID",
                      "This source access is invalid or expired.",
                    ),
                  }
                : { ok: true, participant, expiresAt: participant.overlayExpiresAt! * 1000 },
          );
          continue;
        }
        if (!participant.sessionClaims || participant.sessionClaims.sub !== participant.userId) {
          results.push({ ok: false, error: new AppError(401, "AUTH_REQUIRED", "Sign in again to join this session.") });
          continue;
        }
        const session = sessions[currentIndex++];
        if (!session.ok) {
          results.push(session);
          continue;
        }
        try {
          results.push({
            ok: true,
            expiresAt: Math.min(
              participant.sessionClaims.exp * 1000,
              Date.parse(session.session.expiresAt),
              Date.parse(session.session.idleExpiresAt),
              session.session.staffIdleExpiresAt ? Date.parse(session.session.staffIdleExpiresAt) : Infinity,
            ),
            participant: await participantFromSession(
              db,
              session.session,
              participant.sessionClaims,
              record,
              peopleById.get(participant.userId!) ?? null,
            ),
          });
        } catch (error) {
          if (error instanceof AppError && error.status >= 400 && error.status < 500)
            results.push({ ok: false, error });
          else throw error;
        }
      }

      return results;
    },
  };
}

/** One fresh D1 batch per bounded chunk; a command reuses only its own already-validated snapshot. */
export async function revalidateLiveRoomParticipants(
  db: DatabaseLike,
  participants: readonly LiveRoomParticipant[],
  scope: LiveRoomAccessScope,
  rooms?: Env["LIVE_SESSION_ROOMS"],
): Promise<LiveParticipantReadResult[]> {
  const current = currentLiveRoomCommandRead();
  if (
    current?.eventId === scope.eventId &&
    current.scopeKey === liveRoomAccessScopeKey(scope) &&
    participants.every((participant) => current.participants.has(liveParticipantReadKey(participant)))
  )
    return participants.map((participant) => current.participants.get(liveParticipantReadKey(participant))!);
  const results: LiveParticipantReadResult[] = [];
  for (let offset = 0; offset < participants.length; offset += 512) {
    const read = prepareLiveRoomParticipants(db, participants.slice(offset, offset + 512), scope, rooms);
    results.push(...(await read.decode(await db.batch(read.statements))));
  }
  return results;
}

/**
 * The room record access is checked against: a session's own, or a location's day, whose attendees are those
 * with access to any of its sessions and whose speakers are credited on any of them.
 */
function prepareLiveRoomAccessRead(db: DatabaseLike, scope: LiveRoomAccessScope) {
  if ("session" in scope) {
    const read = prepareLiveRoomSessionRead(db, scope.eventId, scope.session.occurrenceId);
    return {
      statement: read.statement,
      async decode(loaded: D1StatementResult) {
        const record = await read.decode(batchFirst<LiveRoomSessionRow>(loaded));
        return { access: sessionAccess(record), roomIds: record.roomIds };
      },
    };
  }
  const read = prepareLiveLocationChatRead(db, scope.eventId, scope.location.roomId);
  return {
    statement: read.statement,
    async decode(loaded: D1StatementResult) {
      const record = read.decode(batchRows<LiveLocationChatRow>(loaded), scope.location.day);
      const access: LiveRoomAccessRecord = {
        eventId: record.eventId,
        occurrenceIds: record.sessions.map((session) => session.occurrenceId),
        speakersByOccurrence: record.speakersByOccurrence,
      };
      return { access, roomIds: [] as string[] };
    },
  };
}

/** Program, each output the room sets up, and the speaker's lineup beside its screen. */
function liveOverlayViewDrawn(session: Parameters<typeof liveRoomOutputs>[0], view: LiveOverlayView): boolean {
  if (view === "program") return true;
  const outputs = liveRoomOutputs(session);
  if (view === "stage-preview") return outputs.some((output) => output.role === "speaker");
  return outputs.some((output) => output.key === view);
}
