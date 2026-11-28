import { AppError, isAppError } from "../errors";
import { handleError } from "../http";
import { validationFaultFields } from "../logging";
import { assertSameOriginRequest } from "../request-origin";
import { LIVE_ROOM_FAULT_CLOSE_CODE, liveRoomRefusalCloseCode } from "../../../assets/shared/schemas/live-session-room";
export function assertLiveSocketHandshake(request: Request, protocol: string): void {
  if (request.method !== "GET") throw new AppError(405, "METHOD_NOT_ALLOWED", "Open the live room with GET.");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
    throw new AppError(426, "UPGRADE_REQUIRED", "A WebSocket upgrade is required.");
  const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
  if (!offered.includes(protocol))
    throw new AppError(400, "LIVE_ROOM_PROTOCOL_REQUIRED", `Offer the ${protocol} subprotocol.`);
  assertSameOriginRequest(request, new URL(request.url).origin, "live_session_room");
}

/** A socket opened only to close at once, so the page reads why: a browser never sees a handshake's status. */
function closedLiveSocket(code: number, reason: string, protocol: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": protocol } });
}

export function refusedLiveSocket(error: AppError, protocol: string): Response {
  return closedLiveSocket(liveRoomRefusalCloseCode(error.status), error.code, protocol);
}

/**
 * A live socket that failed: a refusal or a malformed handshake answers over
 * HTTP as before, and a fault on our side closes the socket with the fault
 * code and a reference that the logged fault carries. Without that, the page
 * could not tell a server fault from a lost connection.
 */
export function failedLiveSocket(request: Request, error: unknown, protocol: string): Response {
  const upgrade = request.method === "GET" && request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (!upgrade || (isAppError(error) && error.status < 500)) return handleError(error);
  const reference = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const fields = validationFaultFields(error);
  if (fields) console.error(`[live socket] Fault, reference ${reference}:`, error, JSON.stringify(fields));
  else console.error(`[live socket] Fault, reference ${reference}:`, error);
  return closedLiveSocket(LIVE_ROOM_FAULT_CLOSE_CODE, reference, protocol);
}
