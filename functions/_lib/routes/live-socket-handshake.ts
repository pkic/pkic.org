import { AppError } from "../errors";
import { assertSameOriginRequest } from "../request-origin";
import { liveRoomRefusalCloseCode } from "../../../assets/shared/schemas/live-session-room";
export function assertLiveSocketHandshake(request: Request, protocol: string): void {
  if (request.method !== "GET") throw new AppError(405, "METHOD_NOT_ALLOWED", "Open the live room with GET.");
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
    throw new AppError(426, "UPGRADE_REQUIRED", "A WebSocket upgrade is required.");
  const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
  if (!offered.includes(protocol))
    throw new AppError(400, "LIVE_ROOM_PROTOCOL_REQUIRED", `Offer the ${protocol} subprotocol.`);
  assertSameOriginRequest(request, new URL(request.url).origin, "live_session_room");
}
export function refusedLiveSocket(error: AppError, protocol: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(liveRoomRefusalCloseCode(error.status), error.code);
  return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": protocol } });
}
