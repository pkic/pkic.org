import { LIVE_PROGRAM_PROTOCOL, liveProgramParamsSchema } from "../../../assets/shared/schemas/live-room-program";
import { AppError, isAppError } from "../errors";
import { handleError } from "../http";
import type { Env } from "../types";
import { getEventBySlug } from "../services/events";
import { readPublishedProgramRoom } from "../services/live-session/program-room";
import {
  liveProgramAdmissionSchema,
  liveProgramName,
  LIVE_PROGRAM_ADMISSION_HEADER,
} from "../services/live-session/room-program";
import { offeredOverlayToken } from "../services/live-session/room-access";
import { verifyLiveOverlayToken } from "../auth/live-session-overlay-token";
import { getUserSessionToken, resolveUserSessionContext } from "../auth/user-session";
import { hasPermission } from "../auth/permissions";
import { assertLiveSocketHandshake, refusedLiveSocket } from "./live-socket-handshake";
const PATH = /^\/api\/v1\/events\/([^/]+)\/agenda\/rooms\/([^/]+)\/live\/program\/?$/;
export function isLiveProgramSocketPath(request: Request): boolean {
  return PATH.test(new URL(request.url).pathname) && request.headers.get("upgrade")?.toLowerCase() === "websocket";
}
export async function liveProgramSocketRequest(request: Request, env: Env): Promise<Response> {
  try {
    const match = PATH.exec(new URL(request.url).pathname);
    if (!match) throw new AppError(404, "NOT_FOUND", "Not found");
    const params = liveProgramParamsSchema.parse({
      eventSlug: decodeURIComponent(match[1]),
      roomId: decodeURIComponent(match[2]),
    });
    assertLiveSocketHandshake(request, LIVE_PROGRAM_PROTOCOL);
    if (!env.LIVE_SESSION_ROOMS) throw new AppError(503, "LIVE_ROOMS_UNAVAILABLE", "Live rooms are not available.");
    let admission;
    try {
      const event = await getEventBySlug(env.DB, params.eventSlug);
      await readPublishedProgramRoom(env.DB, event.id, params.roomId);
      const token = offeredOverlayToken(request);
      if (token !== null) {
        const claims = await verifyLiveOverlayToken(env.INTERNAL_SIGNING_SECRET, token, {
          eventId: event.id,
          roomId: params.roomId,
        });
        if (!claims)
          throw new AppError(401, "LIVE_OVERLAY_ACCESS_INVALID", "This source access is invalid or expired.");
        admission = { eventId: event.id, roomId: params.roomId, expiresAt: claims.exp };
      } else {
        if (!getUserSessionToken(request))
          throw new AppError(401, "AUTH_REQUIRED", "Sign in to operate the physical room.");
        const { session, claims } = await resolveUserSessionContext(env.DB, request, env);
        if (!session.staff || !hasPermission(session.staff, "agenda:live_moderate", { type: "event", id: event.id }))
          throw new AppError(
            403,
            "LIVE_ROOM_OPERATOR_REQUIRED",
            "Only event operators may follow the physical room program.",
          );
        admission = { eventId: event.id, roomId: params.roomId, expiresAt: claims.exp, sessionClaims: claims };
      }
    } catch (error) {
      if (isAppError(error) && error.status >= 400 && error.status < 500)
        return refusedLiveSocket(error, LIVE_PROGRAM_PROTOCOL);
      throw error;
    }
    return await env.LIVE_SESSION_ROOMS.getByName(liveProgramName(admission.eventId, params.roomId)).fetch(
      new Request("https://live-session-room/program/connect", {
        headers: {
          upgrade: "websocket",
          [LIVE_PROGRAM_ADMISSION_HEADER]: JSON.stringify(liveProgramAdmissionSchema.parse(admission)),
        },
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}
