import { DurableObject } from "cloudflare:workers";
import { bytesToBase64 } from "../../../../assets/shared/base64";
import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_MONITOR_LIMITS,
  SCREEN_MONITOR_PROTOCOL,
  isScreenScreenshot,
  screenMonitorCommandSchema,
  screenMonitorScreenMessageSchema,
  screenMonitorServerMessageSchema,
  screenMonitorStaffMessageSchema,
  type ScreenLiveStatus,
  type ScreenMonitorServerMessage,
  type ScreenQualitySample,
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
import { ScreenMonitorStore, type StoredScreenshot } from "./screen-monitor-store";

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
 * Reload. Each screen also sends a screenshot, as a binary message, more
 * often while any staff socket is open; the monitor tells screens which pace
 * applies. Reports, screenshots and commands never touch D1: the alarm
 * rechecks every socket's access in one batch, and a socket past its lease
 * is closed.
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
      send(server, this.capturePace());
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
      for (const shot of await this.store.screenshots()) send(server, this.screenshotMessage(shot.screenId, shot));
      this.syncCapturePace();
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
    if (admission.role === "screen" && typeof raw !== "string") {
      await this.screenshot(admission.screenId, new Uint8Array(raw));
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
      if (message.success) {
        const { status, sample } = await this.store.reported(admission.screenId, message.data.health, nowIso());
        await this.changed(status, sample);
      }
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
    if (this.admission(socket)?.role === "staff") this.syncCapturePace(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.left(socket);
    closeLiveRoomSocket(socket, 1011, "Monitor error");
    if (this.admission(socket)?.role === "staff") this.syncCapturePace(socket);
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
      this.syncCapturePace();
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
    const [stored, quality] = await Promise.all([this.store.all(), this.store.quality()]);
    const screens = stored.map((status) => this.live(status));
    const known = new Set(screens.map((status) => status.screenId));
    return screenMonitorServerMessageSchema.parse({
      type: "screens.snapshot",
      serverNow: Date.now(),
      control,
      screens,
      quality: quality.filter((history) => known.has(history.screenId)),
    });
  }

  /**
   * How often screens send a screenshot: faster while any staff socket is
   * open (`leaving` is one closing now). Screens hear it when they connect
   * and whenever staff come or go; a screen already at that pace ignores it.
   */
  private capturePace(leaving?: WebSocket) {
    const watched = this.open(SCREEN_MONITOR_STAFF_TAG).some((socket) => socket !== leaving);
    return screenMonitorCommandSchema.parse({
      type: "screen.capture",
      everySeconds: watched ? SCREEN_POLICY.screenshotWatchedSeconds : SCREEN_POLICY.screenshotSeconds,
    });
  }

  private syncCapturePace(leaving?: WebSocket): void {
    const message = this.capturePace(leaving);
    for (const socket of this.open(SCREEN_MONITOR_SCREEN_TAG)) send(socket, message);
  }

  private screenshotMessage(screenId: string, shot: StoredScreenshot): ScreenMonitorServerMessage {
    return screenMonitorServerMessageSchema.parse({
      type: "screens.screenshot",
      serverNow: Date.now(),
      screenId,
      capturedAt: shot.capturedAt,
      jpeg: bytesToBase64(shot.jpeg),
    });
  }

  /** Only the latest JPEG within the limit is kept; anything else, or one sent too soon, is dropped. */
  private async screenshot(screenId: string, bytes: Uint8Array): Promise<void> {
    if (!isScreenScreenshot(bytes)) return;
    const stored = await this.store.screenshot(screenId, bytes, nowIso());
    if (stored) this.toStaff(JSON.stringify(this.screenshotMessage(screenId, stored)));
  }

  /** Staff hear it at once; a socket past its lease hears nothing more. */
  private toStaff(message: string): void {
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

  private async broadcastSnapshot(): Promise<void> {
    for (const socket of this.open(SCREEN_MONITOR_STAFF_TAG)) {
      const admission = this.admission(socket);
      if (admission?.role === "staff") send(socket, await this.snapshot(admission.control));
    }
  }

  private async changed(status: ScreenLiveStatus, sample?: ScreenQualitySample): Promise<void> {
    this.toStaff(
      JSON.stringify(
        screenMonitorServerMessageSchema.parse({
          type: "screens.changed",
          serverNow: Date.now(),
          screen: this.live(status),
          ...(sample ? { sample } : {}),
        }),
      ),
    );
  }

  /**
   * Forgets screens disconnected past the keep window, whether or not other
   * sockets are open, so they stop counting toward the event's limit; then
   * sets the alarm for the next access recheck while sockets are open, or
   * the next screen to forget, whichever comes first.
   */
  private async scheduleRefresh(): Promise<void> {
    const now = Date.now();
    const pruned = await this.store.prune(now);
    if (pruned.forgotten) await this.broadcastSnapshot();
    const refresh = this.open().length ? now + REFRESH_MS : null;
    const due = refresh === null ? pruned.next : pruned.next === null ? refresh : Math.min(refresh, pruned.next);
    const current = await this.ctx.storage.getAlarm();
    if (due === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current === null || current > due || current < now) await this.ctx.storage.setAlarm(due);
  }
}
