import type { LiveRoomAudienceChanged } from "../../../../assets/shared/schemas/live-room-audience";
import type { LiveRoomParticipant } from "./room-admission";
import { serializeLiveRoomMessage } from "./room-projection";

/** The roles whose sockets are the room's attendee page: attendees and the session's speakers. */
const AUDIENCE_ROLES = ["attendee", "speaker"] as const;

/** Whether a socket of this role is on the attendee page, and so counts toward the room's audience. */
export function onLiveAttendeePage(viewer: Pick<LiveRoomParticipant, "role">): boolean {
  return (AUDIENCE_ROLES as readonly string[]).includes(viewer.role);
}

export const LIVE_ROOM_AUDIENCE_POLICY = {
  /** A wave of people joining at the start reaches operators at most once a second. */
  minIntervalMs: 1_000,
} as const;

/**
 * How many distinct people have the room's attendee page open, for
 * operators only. It is counted from the open sockets each time, never
 * stored; after the room hibernates it is counted afresh.
 *
 * A change reaches operators at once, then at most every `minIntervalMs`:
 * changes in between coalesce, and the count is taken again when the interval
 * ends. Nothing is sent when the number is the one operators already have.
 */
export class LiveRoomAudience {
  private sent: number | null = null;
  private sentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Sockets that closed; the runtime can still list one while its close is handled. */
  private readonly gone = new WeakSet<WebSocket>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly eligible: (sockets: WebSocket[]) => WebSocket[],
  ) {}

  /** Distinct people on the attendee page now; several tabs of one person count once. */
  count(): number {
    const people = new Set<string>();
    for (const role of AUDIENCE_ROLES)
      for (const socket of this.ctx.getWebSockets(role)) {
        if (this.gone.has(socket)) continue;
        const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
        if (viewer?.userId) people.add(viewer.userId);
      }
    return people.size;
  }

  /** Someone opened or closed the attendee page; `leaving` is the socket that is closing. */
  changed(leaving?: WebSocket, now = Date.now()): void {
    if (leaving) this.gone.add(leaving);
    if (this.timer) return;
    const wait = this.sentAt + LIVE_ROOM_AUDIENCE_POLICY.minIntervalMs - now;
    if (wait <= 0) this.flush(now);
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  /** A joining operator gets the count now, before the next change. */
  greet(socket: WebSocket): void {
    this.sendTo(socket, serializeLiveRoomMessage(this.message(this.count())));
  }

  private flush(now = Date.now()): void {
    this.timer = null;
    const people = this.count();
    if (people === this.sent) return;
    this.sent = people;
    this.sentAt = now;
    const payload = serializeLiveRoomMessage(this.message(people));
    for (const socket of this.eligible(this.ctx.getWebSockets("operator"))) this.sendTo(socket, payload);
  }

  private message(people: number): LiveRoomAudienceChanged {
    return { type: "audience.changed", people };
  }

  private sendTo(socket: WebSocket, payload: string): void {
    if (!this.eligible([socket]).length) return;
    try {
      socket.send(payload);
    } catch {
      // A socket closing mid-send is cleaned up by its close handler.
    }
  }
}
