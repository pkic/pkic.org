import { LIVE_ROOM_PROTOCOL } from "../../../assets/shared/schemas/live-session-room";
import { liveProgramParamsSchema } from "../../../assets/shared/schemas/live-room-program";
import { AppError, isAppError } from "../errors";
import type { Env } from "../types";
import {
  LIVE_LOCATION_CHAT_ADMISSION_HEADER,
  admitLiveLocationChatParticipant,
  liveLocationChatAdmissionSchema,
  liveLocationChatScope,
} from "../services/live-session/location-chat-admission";
import { liveLocationChatName } from "../services/live-session/room-admission";
import { assertLiveSocketHandshake, failedLiveSocket, refusedLiveSocket } from "./live-socket-handshake";

const PATH = /^\/api\/v1\/events\/([^/]+)\/agenda\/rooms\/([^/]+)\/live\/chat\/?$/;

export function isLiveLocationChatSocketPath(request: Request): boolean {
  return PATH.test(new URL(request.url).pathname);
}

/**
 * A location's chat socket: `GET /api/v1/events/:eventSlug/agenda/rooms/:roomId/live/chat` with
 * `Upgrade: websocket`. It speaks the live room protocol, chat and moderation only. The route admits the
 * caller for the location's current event day and hands the socket to that day's chat.
 */
export async function liveLocationChatSocketRequest(request: Request, env: Env): Promise<Response> {
  try {
    const match = PATH.exec(new URL(request.url).pathname);
    if (!match) throw new AppError(404, "NOT_FOUND", "Not found");
    const params = liveProgramParamsSchema.safeParse({
      eventSlug: decodeURIComponent(match[1]),
      roomId: decodeURIComponent(match[2]),
    });
    if (!params.success)
      throw new AppError(404, "LIVE_LOCATION_CHAT_NOT_FOUND", "This location has no sessions on the approved agenda.");
    assertLiveSocketHandshake(request, LIVE_ROOM_PROTOCOL);
    const rooms = env.LIVE_SESSION_ROOMS;
    if (!rooms) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live session rooms are not available.");
    let admission;
    try {
      admission = await admitLiveLocationChatParticipant(env.DB, env, request, params.data);
    } catch (error) {
      if (isAppError(error) && error.status >= 400 && error.status < 500)
        return refusedLiveSocket(error, LIVE_ROOM_PROTOCOL);
      throw error;
    }
    const { record, participant } = admission;
    const message = liveLocationChatAdmissionSchema.parse({
      eventId: record.eventId,
      scope: liveLocationChatScope(record),
      participant,
      readBookmark: env.DB.getBookmark?.() ?? participant.sessionClaims?.state,
    });
    return await rooms.getByName(liveLocationChatName(record.eventId, record.roomId, record.day)).fetch(
      new Request("https://live-session-room/chat/connect", {
        headers: { upgrade: "websocket", [LIVE_LOCATION_CHAT_ADMISSION_HEADER]: JSON.stringify(message) },
      }),
    );
  } catch (error) {
    return failedLiveSocket(request, error, LIVE_ROOM_PROTOCOL);
  }
}
