import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import { preserveLiveRoomThread, type LiveRoomParticipant } from "./room-admission";
import { revalidateLiveRoomParticipants } from "./room-access";

export function closeLiveRoomSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // The runtime or peer may already have closed the socket.
  }
}

/**
 * The sockets that may receive a protected payload: each one's participant
 * passes fresh canonical authorization in one batch first. A socket whose
 * access ended or changed role closes with the refusal; an infrastructure
 * fault closes them all and throws rather than trusting stale authority.
 */
export async function authorizeLiveRoomRecipients(
  env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">,
  room: { eventId: string; session: { occurrenceId: string } } | null,
  sockets: WebSocket[],
): Promise<WebSocket[]> {
  sockets = sockets.filter((socket) => socket.readyState === WebSocket.OPEN);
  if (!sockets.length || !room) return [];
  const viewers = sockets.map((socket) => socket.deserializeAttachment() as LiveRoomParticipant);
  let results: Awaited<ReturnType<typeof revalidateLiveRoomParticipants>>;
  try {
    results = await revalidateLiveRoomParticipants(
      env.DB,
      viewers,
      room.eventId,
      room.session.occurrenceId,
      env.LIVE_SESSION_ROOMS,
    );
  } catch (error) {
    if (error instanceof AppError && error.status >= 400 && error.status < 500) {
      for (const socket of sockets) closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(error.status), error.code);
      return [];
    }
    // Fail closed on infrastructure faults; do not substitute stale socket authority.
    for (const socket of sockets) closeLiveRoomSocket(socket, 1011, "Room authorization unavailable");
    throw error;
  }
  const authorized: WebSocket[] = [];
  for (let index = 0; index < sockets.length; index++) {
    const result = results[index],
      socket = sockets[index];
    const error = !result.ok
      ? result.error
      : result.participant.role !== viewers[index].role
        ? new AppError(403, "LIVE_SESSION_ACCESS_CHANGED", "Reconnect to use your current session access.")
        : null;
    if (error) {
      closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(error.status), error.code);
      continue;
    }
    if (!result.ok) continue;
    socket.serializeAttachment(
      preserveLiveRoomThread(result.participant, socket.deserializeAttachment() as LiveRoomParticipant),
    );
    authorized.push(socket);
  }
  return authorized;
}
