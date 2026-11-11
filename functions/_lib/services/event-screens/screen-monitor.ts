import { DurableObject } from "cloudflare:workers";
import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorCommandSchema,
  screenMonitorScreenMessageSchema,
  screenMonitorServerMessageSchema,
  screenMonitorStaffMessageSchema,
  type ScreenLiveStatus,
  type ScreenMonitorServerMessage,
} from "../../../../assets/shared/schemas/event-screen-monitor";
import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import type { Env } from "../../types";
import { nowIso } from "../../utils/time";
import { closeLiveRoomSocket } from "../live-session/room-socket-close";
import {
  SCREEN_MONITOR_ADMISSION_HEADER,
  SCREEN_MONITOR_SCREEN_TAG,
  SCREEN_MONITOR_STAFF_TAG,
  prepareScreenMonitorRefresh,
  screenMonitorAccessCurrent,
  screenMonitorAdmissionSchema,
  screenSocketTag,
  type ScreenMonitorAdmission,
} from "./screen-monitor-access";
import { ScreenMonitorStore } from "./screen-monitor-store";

const REFRESH_MS = SCREEN_POLICY.monitorAccessRefreshSeconds * 1000;
const EXPIRED = "SCREEN_MONITOR_ACCESS_EXPIRED";

function refused(code: string, message: string, operationId?: string): ScreenMonitorServerMessage {
  return { type: "screens.refused", code, message, ...(operationId ? { operationId } : {}) };
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* Already closed. */
  }
}

/**
 * One event's screen monitor. Screens report their health over hibernating
 * sockets, staff watch those reports and screen managers send Identify and
 * Reload. Reports and commands never touch D1: the alarm rechecks every
 * socket's access in one batch, and a socket past its lease is closed.
 */
export class EventScreenMonitor extends DurableObject<Env> {
  private readonly store: ScreenMonitorStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new ScreenMonitorStore(ctx.storage);
    // Keep-alive pings are answered without waking the monitor.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    const admission = screenMonitorAdmissionSchema.parse(
      JSON.parse(request.headers.get(SCREEN_MONITOR_ADMISSION_HEADER) ?? ""),
    );
    const { 0: client, 1: server } = new WebSocketPair();
    const response = new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": SCREEN_MONITOR_PROTOCOL },
    });
    if (admission.role === "screen") {
      if (!(await this.store.admits(admission.screenId))) {
        server.accept();
        server.close(liveRoomRefusalCloseCode(429), "SCREEN_MONITOR_FULL");
        return response;
      }
      // A reloaded page may overlap its old one; the oldest beyond the limit gives way.
      const existing = this.open(screenSocketTag(admission.screenId));
      for (const old of existing.slice(0, Math.max(0, existing.length - SCREEN_MONITOR_LIMITS.socketsPerScreen + 1)))
        closeLiveRoomSocket(old, 1000, "Replaced by a newer connection");
      this.ctx.acceptWebSocket(server, [SCREEN_MONITOR_SCREEN_TAG, screenSocketTag(admission.screenId)]);
      server.serializeAttachment(admission);
      await this.changed(await this.store.connected(admission.screenId, nowIso()));
    } else {
      if (this.open(SCREEN_MONITOR_STAFF_TAG).length >= SCREEN_MONITOR_LIMITS.staffConnections) {
        server.accept();
        server.close(liveRoomRefusalCloseCode(429), "SCREEN_MONITOR_FULL");
        return response;
      }
      this.ctx.acceptWebSocket(server, [SCREEN_MONITOR_STAFF_TAG]);
      server.serializeAttachment(admission);
      send(server, await this.snapshot(admission.control));
    }
    await this.scheduleRefresh();
    return response;
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (raw === "ping") return;
    const admission = this.admission(socket);
    if (!admission) return;
    if (!screenMonitorAccessCurrent(admission, Date.now())) {
      closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(401), EXPIRED);
      return;
    }
    const text = typeof raw === "string" ? raw : "";
    if (!text || text.length > SCREEN_MONITOR_LIMITS.messageBytes) {
      closeLiveRoomSocket(socket, 1009, "Message too large");
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (admission.role === "screen") {
      const message = screenMonitorScreenMessageSchema.safeParse(body);
      // A screen has no one to read a refusal; a report the contract refuses is dropped.
      if (message.success)
        await this.changed(await this.store.reported(admission.screenId, message.data.health, nowIso()));
      return;
    }
    const message = screenMonitorStaffMessageSchema.safeParse(body);
    if (!message.success) {
      send(socket, refused("SCREEN_MONITOR_INVALID_MESSAGE", "The monitor could not read that request."));
      return;
    }
    const { type, screenId, operationId } = message.data;
    if (!admission.control) {
      send(socket, refused("SCREEN_MONITOR_READ_ONLY", "Only staff who manage screens can do that.", operationId));
      return;
    }
    const targets = this.open(screenSocketTag(screenId)).filter((target) => {
      const held = this.admission(target);
      return held !== null && screenMonitorAccessCurrent(held, Date.now());
    });
    if (!targets.length) {
      send(socket, refused("SCREEN_NOT_CONNECTED", "This screen is not connected right now.", operationId));
      return;
    }
    const command = screenMonitorCommandSchema.parse(
      type === "screen.identify"
        ? { type, until: new Date(Date.now() + SCREEN_POLICY.identifySeconds * 1000).toISOString() }
        : { type },
    );
    for (const target of targets) send(target, command);
    send(
      socket,
      screenMonitorServerMessageSchema.parse({ type: "screens.sent", operationId, screenId, command: type }),
    );
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    await this.left(socket);
    closeLiveRoomSocket(socket, code, reason);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.left(socket);
    closeLiveRoomSocket(socket, 1011, "Monitor error");
  }

  /**
   * The single owner of access rechecks and forgetting. While sockets are
   * open it rechecks them all in one D1 batch; if that fails, sockets stay
   * until their lease runs out and the next alarm tries again.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const sockets = this.open();
    if (sockets.length) {
      const admissions = sockets.map((socket) => this.admission(socket));
      const known = sockets.flatMap((socket, index) => {
        const admission = admissions[index];
        return admission ? [{ socket, admission }] : [];
      });
      const eventId = known[0]?.admission.eventId;
      if (eventId) {
        try {
          const read = prepareScreenMonitorRefresh(
            this.env.DB,
            eventId,
            known.map((each) => each.admission),
            now,
          );
          const refreshed = await read.decode(await this.env.DB.batch(read.statements));
          for (const [index, { socket, admission }] of known.entries()) {
            const next = refreshed[index];
            if (next) {
              socket.serializeAttachment(next);
              continue;
            }
            closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(403), "SCREEN_MONITOR_ACCESS_ENDED");
            if (admission.role === "screen" && this.open(screenSocketTag(admission.screenId)).length === 0) {
              await this.store.forget(admission.screenId);
              await this.broadcastSnapshot();
            }
          }
        } catch (error) {
          console.error("Screen monitor access refresh failed", error);
        }
      }
      for (const socket of this.open()) {
        const admission = this.admission(socket);
        if (!admission || !screenMonitorAccessCurrent(admission, Date.now()))
          closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(401), EXPIRED);
      }
    }
    await this.scheduleRefresh();
  }

  private open(tag?: string): WebSocket[] {
    return this.ctx.getWebSockets(tag).filter((socket) => socket.readyState === WebSocket.OPEN);
  }

  private admission(socket: WebSocket): ScreenMonitorAdmission | null {
    const parsed = screenMonitorAdmissionSchema.safeParse(socket.deserializeAttachment());
    return parsed.success ? parsed.data : null;
  }

  private async left(socket: WebSocket): Promise<void> {
    const admission = this.admission(socket);
    if (admission?.role !== "screen") return;
    const others = this.open(screenSocketTag(admission.screenId)).filter((other) => other !== socket);
    if (others.length) return;
    const status = await this.store.disconnected(admission.screenId, nowIso());
    if (status) await this.changed(status);
    await this.scheduleRefresh();
  }

  /** Online means a socket of the screen is open now, whatever the stored copy says. */
  private live(status: ScreenLiveStatus): ScreenLiveStatus {
    const online = this.open(screenSocketTag(status.screenId)).length > 0;
    return online === status.online ? status : { ...status, online };
  }

  private async snapshot(control: boolean): Promise<ScreenMonitorServerMessage> {
    const screens = (await this.store.all()).map((status) => this.live(status));
    return screenMonitorServerMessageSchema.parse({ type: "screens.snapshot", control, screens });
  }

  private async broadcastSnapshot(): Promise<void> {
    for (const socket of this.open(SCREEN_MONITOR_STAFF_TAG)) {
      const admission = this.admission(socket);
      if (admission?.role === "staff") send(socket, await this.snapshot(admission.control));
    }
  }

  /** Staff hear each change at once; a socket past its lease hears nothing more. */
  private async changed(status: ScreenLiveStatus): Promise<void> {
    const message = JSON.stringify(
      screenMonitorServerMessageSchema.parse({ type: "screens.changed", screen: this.live(status) }),
    );
    const now = Date.now();
    for (const socket of this.open(SCREEN_MONITOR_STAFF_TAG)) {
      const admission = this.admission(socket);
      if (!admission || !screenMonitorAccessCurrent(admission, now)) continue;
      try {
        socket.send(message);
      } catch {
        /* Already closed. */
      }
    }
  }

  /** The next access recheck while sockets are open, else the next screen to forget. */
  private async scheduleRefresh(): Promise<void> {
    const due = this.open().length ? Date.now() + REFRESH_MS : await this.store.prune(Date.now());
    const current = await this.ctx.storage.getAlarm();
    if (due === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current === null || current > due || current < Date.now()) await this.ctx.storage.setAlarm(due);
  }
}
