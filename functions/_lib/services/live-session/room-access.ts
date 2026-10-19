import { resolveUserSessionClaimsBatch } from "../../auth/user-session-live-data";
import type { LiveRoomRole } from "../../../../assets/shared/live-session-policy";
import { LIVE_OVERLAY_PROTOCOL_PREFIX } from "../../../../assets/shared/schemas/live-session-room";
import { verifyLiveOverlayToken } from "../../auth/live-session-overlay-token";
import { hasPermission } from "../../auth/permissions";
import { resolveUserSessionClaims, resolveUserSessionContext } from "../../auth/user-session";
import type { UserSessionResult } from "../../auth/user-session-result";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { getUserSessionToken } from "../../auth/user-session-token";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { personDisplayNameSql } from "../event-agenda/speaker-name";
import { publishedSessionsSql } from "../event-participation/published-schedule";
import { sessionAccessEligibleSql } from "../event-participation/session-access";
import { getEventBySlug } from "../events";
import { liveProgramName } from "./room-program";
import { publicUserHeadshotPath } from "../user-headshot";
import { readLiveRoomSession, type LiveRoomSessionRecord } from "./room-session";
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

/** The person behind a socket, as the room names and pictures them. */
interface LiveRoomPerson {
  name: string;
  attendee: number;
  headshot_r2_key: string | null;
}

async function signedInParticipant(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  record: LiveRoomSessionRecord,
): Promise<LiveRoomParticipant> {
  if (!getUserSessionToken(request)) throw new AppError(401, "AUTH_REQUIRED", "Sign in to join this session.");
  const { session, claims } = await resolveUserSessionContext(db, request, env);
  return participantFromSession(db, session, claims, record);
}

async function participantFromSession(
  db: DatabaseLike,
  session: UserSessionResult,
  claims: UserSessionTokenClaims,
  record: LiveRoomSessionRecord,
  currentPerson?: LiveRoomPerson | null,
): Promise<LiveRoomParticipant> {
  const userId = session.identity.id;
  const occurrenceId = record.session.occurrenceId;
  const person =
    currentPerson !== undefined
      ? currentPerson
      : await first<LiveRoomPerson>(
          db,
          `SELECT ${personDisplayNameSql("person", "Attendee")} AS name, ${livePersonHeadshotSql("person")} AS headshot_r2_key,
      EXISTS(SELECT 1 FROM registrations registration WHERE registration.event_id=? AND registration.user_id=person.id AND registration.status='registered'
        AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) access_session
          WHERE access_session.event_id=registration.event_id AND access_session.id=? AND ${sessionAccessEligibleSql("access_session", "person.id", null, false)})) AS attendee
     FROM users person WHERE person.id=? AND person.active=1`,
          [record.eventId, occurrenceId, userId],
        );
  if (!person) throw new AppError(401, "AUTH_REQUIRED", "Sign in again to join this session.");
  // Operating the room is a staff capacity, exactly as on the control room's other staff routes.
  const operator =
    session.staff !== undefined &&
    hasPermission(session.staff, "agenda:live_moderate", { type: "event", id: record.eventId });
  const role: LiveRoomRole | null = operator
    ? "operator"
    : record.speakerUserIds.includes(userId)
      ? "speaker"
      : person.attendee
        ? "attendee"
        : null;
  if (!role)
    throw new AppError(
      403,
      "LIVE_SESSION_ACCESS_REQUIRED",
      "A confirmed event registration and access to this session are required to join its questions.",
    );
  // Restricting people from chat is the organizers' call, as their other event-wide decisions are.
  const organizer = operator && hasPermission(session.staff!, "events:manage", { type: "event", id: record.eventId });
  return {
    role,
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
  return { ...record, participant: await signedInParticipant(db, request, env, record) };
}

/** Reuse the canonical live session and room policies for every socket command. */
export async function revalidateLiveRoomParticipant(
  db: DatabaseLike,
  participant: LiveRoomParticipant,
  eventId: string,
  occurrenceId: string,
  rooms?: Env["LIVE_SESSION_ROOMS"],
): Promise<LiveRoomParticipant> {
  if (participant.role === "overlay") {
    const record = await readLiveRoomSession(db, eventId, occurrenceId);
    if (!participant.overlayRoomId || participant.overlayExpiresAt === undefined)
      throw new AppError(401, "LIVE_OVERLAY_ACCESS_INVALID", "This source access is invalid or expired.");
    if (
      (participant.overlayExpiresAt !== undefined && participant.overlayExpiresAt <= Date.now() / 1000) ||
      (participant.overlayRoomId && !record.roomIds.includes(participant.overlayRoomId))
    )
      throw new AppError(401, "LIVE_OVERLAY_ACCESS_INVALID", "This source access is invalid or expired.");
    if (participant.overlayRoomId) {
      if (!rooms) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
      const selection = await rooms
        .getByName(liveProgramName(eventId, participant.overlayRoomId))
        .readProgram(eventId, participant.overlayRoomId);
      if (selection.occurrenceId !== occurrenceId)
        throw new AppError(403, "LIVE_PROGRAM_SELECTION_CHANGED", "This source follows another active session now.");
    }
    return participant;
  }
  if (!participant.sessionClaims || participant.sessionClaims.sub !== participant.userId)
    throw new AppError(401, "AUTH_REQUIRED", "Sign in again to join this session.");
  const session = await resolveUserSessionClaims(db, participant.sessionClaims);
  const record = await readLiveRoomSession(db, eventId, occurrenceId);
  return participantFromSession(db, session, participant.sessionClaims, record);
}

/** One fresh canonical claims batch and one setwise person/room check per bounded chunk. */
export async function revalidateLiveRoomParticipants(
  db: DatabaseLike,
  participants: readonly LiveRoomParticipant[],
  eventId: string,
  occurrenceId: string,
  rooms?: Env["LIVE_SESSION_ROOMS"],
): Promise<Array<{ ok: true; participant: LiveRoomParticipant } | { ok: false; error: AppError }>> {
  const record = await readLiveRoomSession(db, eventId, occurrenceId);
  const physicalRooms = [
    ...new Set(
      participants
        .filter((p) => p.role === "overlay" && p.overlayRoomId && record.roomIds.includes(p.overlayRoomId))
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
  const results: Array<{ ok: true; participant: LiveRoomParticipant } | { ok: false; error: AppError }> = [];
  for (let offset = 0; offset < participants.length; offset += 512) {
    const slice = participants.slice(offset, offset + 512);
    const valid = slice.filter((p) => p.role !== "overlay" && p.sessionClaims && p.sessionClaims.sub === p.userId);
    const claims = valid.map((p) => p.sessionClaims!);
    const sessions = await resolveUserSessionClaimsBatch(db, claims);
    const userIds = JSON.stringify([...new Set(valid.map((p) => p.userId))]);
    const people = await all<LiveRoomPerson & { id: string }>(
      db,
      `SELECT person.id, ${personDisplayNameSql("person", "Attendee")} AS name, ${livePersonHeadshotSql("person")} AS headshot_r2_key,
       EXISTS(SELECT 1 FROM registrations registration WHERE registration.event_id=? AND registration.user_id=person.id AND registration.status='registered'
        AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) access_session
          WHERE access_session.event_id=registration.event_id AND access_session.id=? AND ${sessionAccessEligibleSql("access_session", "person.id", null, false)})) AS attendee
       FROM users person JOIN json_each(?) requested ON requested.value=person.id WHERE person.active=1`,
      [eventId, occurrenceId, userIds],
    );
    const peopleById = new Map(people.map((person) => [person.id, person]));
    let currentIndex = 0;
    for (const participant of slice) {
      if (participant.role === "overlay") {
        const refused =
          !participant.overlayRoomId ||
          participant.overlayExpiresAt === undefined ||
          (participant.overlayExpiresAt !== undefined && participant.overlayExpiresAt <= Date.now() / 1000) ||
          (participant.overlayRoomId && !record.roomIds.includes(participant.overlayRoomId));
        const inactive = participant.overlayRoomId && programSelections.get(participant.overlayRoomId) !== occurrenceId;
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
                  error: new AppError(401, "LIVE_OVERLAY_ACCESS_INVALID", "This source access is invalid or expired."),
                }
              : { ok: true, participant },
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
          participant: await participantFromSession(
            db,
            session.session,
            participant.sessionClaims,
            record,
            peopleById.get(participant.userId!) ?? null,
          ),
        });
      } catch (error) {
        if (error instanceof AppError && error.status >= 400 && error.status < 500) results.push({ ok: false, error });
        else throw error;
      }
    }
  }
  return results;
}
