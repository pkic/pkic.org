import { LIVE_PRESENCE_POLICY, livePresenceKey } from "../../../../assets/shared/live-room-presence";
import type {
  LivePresence,
  LivePresenceUpdate,
  LiveRoomServerMessage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import { serializeLiveRoomMessage } from "./room-projection";

type Operator = { userId: string; name: string };

interface Pending {
  userId: string;
  presence: LivePresence;
  sentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Which control each operator is on, and where they point on a monitor.
 * Presence lives in memory only: it is never stored, is gone when the room
 * hibernates or the operator disconnects, and reaches other operators only.
 *
 * Each operator is fanned out at most every `minIntervalMs`. Updates in
 * between coalesce into the latest one, which is sent when the interval ends,
 * so a burst never leaves other screens on a stale position. A change flag
 * survives coalescing until it is sent.
 *
 * Presence rides on the full access check of a socket's other room messages:
 * at ten updates a second, the room re-checks a sender's access once every
 * `revalidateMs` instead of on every update, and fans out to the operator
 * sockets every other broadcast keeps authorized.
 */
export class LiveRoomPresence {
  private readonly people = new Map<string, Pending>();
  private readonly checked = new WeakMap<WebSocket, number>();

  constructor(private readonly ctx: DurableObjectState) {}

  /** The socket just passed the room's full access check. */
  authorized(socket: WebSocket, now = Date.now()): void {
    this.checked.set(socket, now);
  }

  /** Whether a presence update from this socket may ride on its last access check. */
  recentlyAuthorized(socket: WebSocket, now = Date.now()): boolean {
    const at = this.checked.get(socket);
    return at !== undefined && now - at < LIVE_PRESENCE_POLICY.revalidateMs;
  }

  update(operator: Operator, update: LivePresenceUpdate, now = Date.now()): void {
    const id = livePresenceKey(operator.userId);
    const entry = this.people.get(id);
    const presence: LivePresence = {
      id,
      name: operator.name,
      focus: update.focus,
      pointer: update.pointer,
      changed: update.changed || Boolean(entry?.timer && entry.presence.changed),
    };
    if (!entry) {
      this.people.set(id, { userId: operator.userId, presence, sentAt: now, timer: null });
      this.fanOut({ type: "presence.changed", presence }, operator.userId);
      return;
    }
    entry.presence = presence;
    if (entry.timer) return;
    const wait = entry.sentAt + LIVE_PRESENCE_POLICY.minIntervalMs - now;
    if (wait <= 0) this.flush(id, now);
    else entry.timer = setTimeout(() => this.flush(id), wait);
  }

  /** An operator's socket closed: their presence leaves every other screen. */
  left(viewer: LiveRoomParticipant): void {
    if (viewer.role !== "operator" || !viewer.userId) return;
    const id = livePresenceKey(viewer.userId);
    const entry = this.people.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.people.delete(id);
    this.fanOut({ type: "presence.left", id }, viewer.userId);
  }

  /** A joining operator sees where everyone else already is. */
  greet(socket: WebSocket, viewer: LiveRoomParticipant): void {
    if (viewer.role !== "operator") return;
    for (const entry of this.people.values()) {
      if (entry.userId === viewer.userId) continue;
      this.sendTo(socket, serializeLiveRoomMessage({ type: "presence.changed", presence: entry.presence }));
    }
  }

  private flush(id: string, now = Date.now()): void {
    const entry = this.people.get(id);
    if (!entry) return;
    entry.timer = null;
    entry.sentAt = now;
    this.fanOut({ type: "presence.changed", presence: entry.presence }, entry.userId);
    entry.presence = { ...entry.presence, changed: false };
  }

  private fanOut(message: LiveRoomServerMessage, senderUserId: string): void {
    const payload = serializeLiveRoomMessage(message);
    for (const socket of this.ctx.getWebSockets("operator")) {
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
      if (viewer?.role !== "operator" || viewer.userId === senderUserId) continue;
      this.sendTo(socket, payload);
    }
  }

  private sendTo(socket: WebSocket, payload: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(payload);
    } catch {
      // A socket closing mid-send is cleaned up by its close handler.
    }
  }
}
