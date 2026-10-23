import {
  LIVE_ROOM_PROTOCOL,
  liveRoomParamsSchema,
  liveRoomSocketQuerySchema,
} from "../../../assets/shared/schemas/live-session-room";
import { AppError, isAppError } from "../errors";
import { handleError } from "../http";
import { assertLiveSocketHandshake, refusedLiveSocket } from "./live-socket-handshake";
import { isLiveProgramSocketPath, liveProgramSocketRequest } from "./live-program-socket";
import { admitLiveRoomParticipant } from "../services/live-session/room-access";
import {
  LIVE_ROOM_ADMISSION_HEADER,
  liveRoomAdmissionSchema,
  liveRoomName,
} from "../services/live-session/room-admission";
import type { Env } from "../types";

const LIVE_ROOM_PATH = /^\/api\/v1\/events\/([^/]+)\/agenda\/occurrences\/([^/]+)\/live\/?$/;

/**
 * The live room socket: `GET /api/v1/events/:eventSlug/agenda/occurrences/:occurrenceId/live`
 * with `Upgrade: websocket`. It is dispatched before the HTTP router because
 * a 101 response must reach the runtime untouched by response middleware.
 * The route validates the shared params, admits the caller and hands the
 * socket to the session's room; an admission it refuses closes the socket
 * with the refusal's code. The caller checks `isLiveRoomSocketPath` first, so
 * no other request opens a database session here.
 */
export function isLiveRoomSocketPath(request: Request): boolean {
  return LIVE_ROOM_PATH.test(new URL(request.url).pathname) || isLiveProgramSocketPath(request);
}

export async function liveRoomSocketRequest(request: Request, env: Env): Promise<Response> {
  if (isLiveProgramSocketPath(request)) return liveProgramSocketRequest(request, env);
  try {
    const match = LIVE_ROOM_PATH.exec(new URL(request.url).pathname);
    if (!match) throw new AppError(404, "NOT_FOUND", "Not found");
    const params = liveRoomParamsSchema.safeParse({
      eventSlug: decodeURIComponent(match[1]),
      occurrenceId: decodeURIComponent(match[2]),
    });
    if (!params.success)
      throw new AppError(404, "LIVE_SESSION_NOT_FOUND", "This session is not on the approved agenda.");
    const query = liveRoomSocketQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new AppError(400, "LIVE_ROOM_INVALID_OUTPUT", "This output is not one a room draws.");
    assertLiveSocketHandshake(request, LIVE_ROOM_PROTOCOL);
    const rooms = env.LIVE_SESSION_ROOMS;
    if (!rooms) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live session rooms are not available.");
    let admission;
    try {
      admission = await admitLiveRoomParticipant(env.DB, env, request, { ...params.data, ...query.data });
    } catch (error) {
      if (isAppError(error) && error.status >= 400 && error.status < 500)
        return refusedLiveSocket(error, LIVE_ROOM_PROTOCOL);
      throw error;
    }
    const message = liveRoomAdmissionSchema.parse({
      eventId: admission.eventId,
      session: admission.session,
      participant: admission.participant,
      readBookmark: env.DB.getBookmark?.() ?? admission.participant.sessionClaims?.state,
    });
    return await rooms.getByName(liveRoomName(admission.eventId, params.data.occurrenceId)).fetch(
      new Request("https://live-session-room/connect", {
        headers: { upgrade: "websocket", [LIVE_ROOM_ADMISSION_HEADER]: JSON.stringify(message) },
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}
