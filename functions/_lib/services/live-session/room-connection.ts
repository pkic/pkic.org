import { LIVE_ROOM_PROTOCOL } from "../../../../assets/shared/schemas/live-session-room";
import { liveRoomPurgeAt } from "../../../../assets/shared/live-session-policy";
import type { LiveRoomAccessLease } from "./room-access-lease";
import { LIVE_ROOM_ADMISSION_HEADER, liveRoomAdmissionSchema } from "./room-admission";
import type { LiveRoomBroadcast } from "./room-broadcast";
import { refreshLiveCreditCopies } from "./room-credit-refresh";
import type { LiveRoomDatabaseSession } from "./room-database-session";
import type { LiveRoomGraphics } from "./room-graphics";
import type { LiveRoomPresence } from "./room-presence";
import type { LiveRoomStore } from "./room-store";
import { LIVE_TICKER_REFRESH_MS } from "./room-ticker";

interface LiveOccurrenceConnection {
  ctx: DurableObjectState;
  store: LiveRoomStore;
  access: LiveRoomAccessLease;
  broadcast: LiveRoomBroadcast;
  graphics: LiveRoomGraphics;
  presence: LiveRoomPresence;
  databaseSession: LiveRoomDatabaseSession;
  scheduleAlarm(at: number): Promise<void>;
}

/** Opens the occurrence socket and sends its first authorized snapshot. */
export async function connectLiveOccurrence(request: Request, parts: LiveOccurrenceConnection): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  const admission = liveRoomAdmissionSchema.parse(JSON.parse(request.headers.get(LIVE_ROOM_ADMISSION_HEADER) ?? ""));
  parts.databaseSession.seedBookmark(admission.readBookmark ?? admission.participant.sessionClaims?.state);
  parts.store.saveSession(admission.eventId, admission.session, admission.roomIds);
  for (const message of refreshLiveCreditCopies(parts.store, admission.session)) await parts.broadcast.all(message);
  await parts.graphics.initialize();
  await parts.scheduleAlarm(Math.min(liveRoomPurgeAt(admission.session.endAt), Date.now() + LIVE_TICKER_REFRESH_MS));
  const { 0: client, 1: server } = new WebSocketPair();
  parts.ctx.acceptWebSocket(server, [admission.participant.role]);
  server.serializeAttachment(admission.participant);
  await parts.access.admit(server);
  const refreshAt = parts.access.nextRefreshAt();
  if (refreshAt !== null) await parts.scheduleAlarm(refreshAt);
  const snapshot = await parts.broadcast.snapshot(server, admission.session);
  if (snapshot !== null && server.readyState === WebSocket.OPEN) server.send(snapshot);
  if (admission.participant.role === "operator") {
    await parts.broadcast.operatorsChanged();
    parts.presence.greet(server, admission.participant);
  }
  if (admission.participant.role === "overlay") await parts.broadcast.sourcesChanged();
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "sec-websocket-protocol": LIVE_ROOM_PROTOCOL },
  });
}
