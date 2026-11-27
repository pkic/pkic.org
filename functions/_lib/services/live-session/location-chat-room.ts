import { LIVE_CHAT_POLICY } from "../../../../assets/shared/live-chat-policy";
import { liveLocationChatOpen } from "../../../../assets/shared/live-location-chat";
import {
  LIVE_INTERACTION_BROADCAST_MILLISECONDS,
  LIVE_ROOM_POLICY,
  liveRoomPurgeAt,
} from "../../../../assets/shared/live-session-policy";
import { LIVE_ROOM_PROTOCOL, type LiveRoomClientMessage } from "../../../../assets/shared/schemas/live-session-room";
import type { Env } from "../../types";
import { nowIso } from "../../utils/time";
import { LIVE_LOCATION_CHAT_ADMISSION_HEADER, liveLocationChatAdmissionSchema } from "./location-chat-admission";
import { copyLiveLocationChatToD1 } from "./location-chat-copy";
import type { LiveLocationChatStore } from "./location-chat-store";
import { liveProgramName } from "./room-program";
import type { LiveRoomAccessLease } from "./room-access-lease";
import { liveRoomName, type LiveRoomParticipant } from "./room-admission";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRoomChatActions } from "./room-chat-actions";
import type { LiveChatFeed } from "./room-chat-feed";
import type { LiveRefusal } from "./room-controls";
import type { LiveRoomParticipation } from "./room-participation";
import type { LiveChatOnAirOptions, LiveChatQuestion } from "./location-chat-on-air";
import type { LiveRoomChat } from "./room-chat";
import { liveChatOnAirMessages } from "./room-ticker";
import type { LiveRoomStore } from "./room-store";
import { serializeLiveRoomMessage } from "./room-projection";
import { seesChatOccurrence } from "./room-chat-audience";
import { LIVE_PARTICIPATION_REFUSAL } from "./room-participation-refusal";
import type { LiveOccurrenceModerationChange } from "./room-occurrence-participation";
import type { LiveEventBlockDecision } from "./room-occurrence-participation";

/** The socket tag of a location chat's connections, beside each connection's role. */
export const LIVE_LOCATION_CHAT_SOCKET_TAG = "location-chat";

const REFUSALS = {
  closed: { code: "LIVE_ROOM_CLOSED", message: "The chat opens shortly before the location's first session." },
  ended: { code: "LIVE_ROOM_CLOSED", message: "The organizers ended this chat." },
  operatorOnly: { code: "LIVE_ROOM_OPERATOR_REQUIRED", message: "Only the event's operators can do that." },
  unsupported: { code: "LIVE_ROOM_INVALID_MESSAGE", message: "A location's chat does not take that request." },
  noSession: {
    code: "LIVE_CHAT_NO_SESSION",
    message: "Load a session in the studio first, so the question has a session to go to.",
  },
} satisfies Record<string, LiveRefusal>;

type Actor = { userId: string; name: string };

/** What a location's chat uses of its room object: the chat, its moderation, access and delivery. */
export interface LiveLocationChatParts {
  ctx: DurableObjectState;
  env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">;
  store: LiveLocationChatStore;
  chat: LiveRoomChat;
  access: LiveRoomAccessLease;
  broadcast: LiveRoomBroadcast;
  feed: LiveChatFeed;
  chatActions: LiveRoomChatActions;
  participation: LiveRoomParticipation;
  seedBookmark: (bookmark?: string | null) => void;
  staff: Pick<LiveRoomStore, "recordStaffAction">;
  /** The day's retention is over and everything is copied: erase the object, or keep its chat longer. */
  purge: () => Promise<void>;
}

/**
 * A location's chat for one event day. It follows the agenda, not the studio: it opens shortly before the
 * day's first session there and closes a while after its last, whether or not anyone runs the studio, unless
 * an operator ends it or opens it past its close. Each message is dated by the session the studio has loaded,
 * else the one the agenda has on, else none. It takes chat and moderation; questions and polls stay with
 * each session's room.
 */
export class LiveLocationChatRoom {
  private onAirTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly parts: LiveLocationChatParts) {}

  /** The session on in the location now: the one the studio has loaded, else the agenda's, else none. */
  private sessionOn(): string | null {
    const { store } = this.parts;
    return store.state()?.loadedOccurrenceId ?? store.stamp(Date.now());
  }

  /** Use the occurrence room as the authority for its opening and moderation decisions. */
  occurrenceModeration(occurrenceId: string | null) {
    const state = this.parts.store.state();
    const rooms = this.parts.env.LIVE_SESSION_ROOMS;
    const occurrence = state?.scope.sessions.find((session) => session.occurrenceId === occurrenceId);
    if (!state || !rooms || !occurrence) return null;
    const room = rooms.getByName(liveRoomName(state.eventId, occurrence.occurrenceId));
    return {
      read: (userId: string) => room.readOccurrenceParticipation(userId),
      restrictions: (userIds: string[]) => room.readOccurrenceRestrictions(userIds),
      change: (userId: string, change: LiveOccurrenceModerationChange) =>
        room.changeOccurrenceModeration(userId, occurrence.endAt, change),
    };
  }

  async checkWrite(viewer: LiveRoomParticipant, occurrenceId: string | null) {
    if (viewer.role === "operator") return null;
    const { store, feed } = this.parts;
    const state = store.state();
    if (!state || !viewer.userId || !seesChatOccurrence(viewer, occurrenceId)) return REFUSALS.closed;
    if (feed.decisions.restriction(viewer.userId, Date.now())) return LIVE_PARTICIPATION_REFUSAL;
    const rooms = this.parts.env.LIVE_SESSION_ROOMS;
    if (!rooms) return REFUSALS.closed;
    const loaded = await rooms
      .getByName(liveProgramName(state.eventId, state.scope.roomId))
      .loadedProgram(state.eventId, state.scope.roomId);
    if (loaded !== store.state()?.loadedOccurrenceId) {
      this.loaded(loaded);
      return REFUSALS.closed;
    }
    const currentOccurrenceId = store.stamp(Date.now());
    if (!seesChatOccurrence(viewer, currentOccurrenceId)) return REFUSALS.closed;
    const occurrences = [...new Set([currentOccurrenceId, occurrenceId])].filter((id) => id !== null);
    const policies = await Promise.all(occurrences.map((id) => this.occurrenceModeration(id)?.read(viewer.userId!)));
    if (policies.some((policy) => policy?.restriction)) return LIVE_PARTICIPATION_REFUSAL;
    if (policies.some((policy) => !policy || policy.opening === "closed")) return REFUSALS.ended;
    const latest = store.state();
    if (!latest || store.stamp(Date.now()) !== currentOccurrenceId) return REFUSALS.closed;
    if (latest.opening === "closed") return REFUSALS.ended;
    if (
      (currentOccurrenceId === null || policies[0]?.opening !== "open") &&
      !liveLocationChatOpen(Date.now(), latest.scope.sessions, latest.opening)
    )
      return REFUSALS.closed;
    return feed.decisions.restriction(viewer.userId, Date.now()) ? LIVE_PARTICIPATION_REFUSAL : null;
  }

  async onAir(occurrenceId: string, limit: number, options: LiveChatOnAirOptions) {
    const { store, chat } = this.parts;
    if (!store.state()) return [];
    const messages = await liveChatOnAirMessages(chat, occurrenceId, limit, options);
    chat.markAired(messages.map(({ id }) => id));
    return messages;
  }

  /** Attendee chat changed: the session on air fills its chat feed and ticker again, once the moment's changes are in. */
  onAirChanged(): void {
    this.onAirTimer ??= setTimeout(() => {
      this.onAirTimer = null;
      const state = this.parts.store.state();
      const occurrenceId = this.sessionOn();
      const rooms = this.parts.env.LIVE_SESSION_ROOMS;
      if (!state || !occurrenceId || !rooms) return;
      this.parts.ctx.waitUntil(
        rooms
          .getByName(liveRoomName(state.eventId, occurrenceId))
          .locationChatChanged()
          .catch((error: unknown) => console.error("Live location chat on air notice failed", error)),
      );
    }, LIVE_INTERACTION_BROADCAST_MILLISECONDS);
  }

  /**
   * Asks a converted message in the room of the session on: the one the studio has loaded, else the agenda's.
   * A message from an earlier session asks there too, so a question never lands in a session that is over.
   * Between sessions with nothing loaded there is no room to ask it in.
   */
  async ask(question: LiveChatQuestion, by: Actor, at: string) {
    const state = this.parts.store.state();
    const occurrenceId = this.sessionOn();
    const rooms = this.parts.env.LIVE_SESSION_ROOMS;
    if (!state || !occurrenceId || !rooms) return REFUSALS.noSession;
    const id = await rooms.getByName(liveRoomName(state.eventId, occurrenceId)).questionFromChat(question, by, at);
    return id ?? REFUSALS.noSession;
  }

  async connect(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    const { ctx, store, access, env } = this.parts;
    const admission = liveLocationChatAdmissionSchema.parse(
      JSON.parse(request.headers.get(LIVE_LOCATION_CHAT_ADMISSION_HEADER) ?? ""),
    );
    this.parts.seedBookmark(admission.readBookmark ?? admission.participant.sessionClaims?.state);
    // A chat that starts while the studio already runs a session learns of it here; the studio tells it of later ones.
    if (store.save(admission) && env.LIVE_SESSION_ROOMS)
      store.loaded(
        await env.LIVE_SESSION_ROOMS.getByName(
          liveProgramName(admission.eventId, admission.scope.roomId),
        ).loadedProgram(admission.eventId, admission.scope.roomId),
      );
    const { 0: client, 1: server } = new WebSocketPair();
    ctx.acceptWebSocket(server, [admission.participant.role, LIVE_LOCATION_CHAT_SOCKET_TAG]);
    server.serializeAttachment(admission.participant);
    await access.admit(server);
    await this.scheduleAlarm();
    const snapshot = await this.snapshot(server);
    if (snapshot !== null && server.readyState === WebSocket.OPEN) server.send(snapshot);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": LIVE_ROOM_PROTOCOL },
    });
  }

  /** The studio loaded a session in the location, or none. A chat nobody joined yet learns it on its first join. */
  loaded(occurrenceId: string | null): void {
    if (!this.parts.store.state()) return;
    this.parts.store.loaded(occurrenceId);
    this.parts.ctx.waitUntil(this.syncAccess());
    // The session now on air shows this chat from the start.
    this.onAirChanged();
  }

  async accessChanged(occurrenceId: string, userId: string | null, decision?: LiveEventBlockDecision): Promise<void> {
    const { store, chat, chatActions, feed } = this.parts;
    if (!store.state()) return;
    // The occurrence decided an event block in D1: the chat takes it now, not at its next access read.
    if (userId && decision) feed.decisions.decideEventBlock(userId, decision);
    const onAir = store.stamp(Date.now()) === occurrenceId;
    // An event decision holds across sessions: the person's chat learns it even with no session on air.
    if (onAir || (userId && decision)) await this.syncAccess(userId);
    if (onAir) this.onAirChanged();
    if (userId) await chatActions.redeliver(chat.byAuthor(userId, LIVE_CHAT_POLICY.storedMessages, occurrenceId));
  }

  private async syncAccess(userId: string | null = null): Promise<void> {
    const { store, ctx, broadcast, feed } = this.parts;
    const occurrenceId = store.stamp(Date.now());
    const viewers = ctx.getWebSockets().flatMap((socket) => {
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
      return viewer?.userId && viewer.role !== "operator" && (!userId || viewer.userId === userId) ? [viewer] : [];
    });
    if (!viewers.length) return;
    const activeViewers = viewers.filter((viewer) => seesChatOccurrence(viewer, occurrenceId));
    const userIds = [...new Set(activeViewers.flatMap((viewer) => viewer.userId ?? []))];
    const occurrence = this.occurrenceModeration(occurrenceId);
    const [policy, restrictions] = await Promise.all([
      occurrence && userIds.length ? occurrence.read(userIds[0]) : undefined,
      occurrence && userIds.length ? occurrence.restrictions(userIds) : undefined,
    ]);
    if (store.stamp(Date.now()) !== occurrenceId) return;
    await broadcast.send((viewer) => {
      if (!viewer.userId || viewer.role === "operator" || (userId && viewer.userId !== userId)) return null;
      const allowed = seesChatOccurrence(viewer, occurrenceId);
      return {
        type: "location.chat.access",
        sessionClosed: !allowed || policy?.opening === "closed",
        restriction:
          feed.decisions.restriction(viewer.userId, Date.now()) ??
          (allowed ? restrictions?.[viewer.userId] : null) ??
          null,
      };
    }, null);
  }

  private snapshot(socket: WebSocket): Promise<string | null> {
    const { access, ctx, feed, store } = this.parts;
    return access.run(async () => {
      const eligible = await access.authorize(ctx.getWebSockets());
      const state = store.state();
      if (!state || !eligible.includes(socket) || socket.readyState !== WebSocket.OPEN) return null;
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      const occurrenceId = store.stamp(Date.now());
      const policy =
        viewer.userId && viewer.role !== "operator" && seesChatOccurrence(viewer, occurrenceId)
          ? await this.occurrenceModeration(occurrenceId)?.read(viewer.userId)
          : undefined;
      if (socket.readyState !== WebSocket.OPEN) return null;
      return serializeLiveRoomMessage({
        type: "location.chat.snapshot",
        viewer: {
          role: viewer.role,
          name: viewer.name,
          organizer: viewer.organizer ?? false,
          participation:
            viewer.role === "operator"
              ? null
              : (feed.decisions.restriction(viewer.userId, Date.now()) ?? policy?.restriction ?? null),
        },
        scope: {
          ...state.scope,
          sessions: state.scope.sessions.filter(({ occurrenceId }) => seesChatOccurrence(viewer, occurrenceId)),
        },
        opening: state.opening,
        sessionClosed: !seesChatOccurrence(viewer, occurrenceId) || policy?.opening === "closed",
        ...(await feed.snapshot(viewer)),
      });
    });
  }

  async handle(viewer: LiveRoomParticipant, actor: Actor, message: LiveRoomClientMessage, socket: WebSocket) {
    const { chatActions, participation, store, broadcast } = this.parts;
    const state = store.state();
    if (!state) return REFUSALS.unsupported;
    const operator = viewer.role === "operator";
    switch (message.type) {
      case "chat.send":
      case "chat.edit":
      case "chat.react":
      case "chat.report":
      case "chat.delete":
      case "chat.history":
        return chatActions.handle(viewer, actor, message, socket);
      case "chat.moderate":
      case "chat.convert":
      case "chat.pin":
      case "chat.unpin":
        return operator ? chatActions.handle(viewer, actor, message, socket) : REFUSALS.operatorOnly;
      case "author.lookup":
        return chatActions.lookupAuthor(viewer, actor, message.handle, socket);
      case "moderation.done":
        return participation.done(viewer, actor, message.item, message.done);
      case "participation.block":
        return participation.block(viewer, actor, message);
      case "participation.lift":
        return participation.lift(viewer, actor, message.item);
      case "room.opening":
        if (!operator) return REFUSALS.operatorOnly;
        if (message.opening === state.opening) return;
        store.setOpening(message.opening);
        this.parts.staff.recordStaffAction(
          actor.userId,
          "live_session.location_chat.opening",
          { opening: message.opening },
          nowIso(),
        );
        await broadcast.all({ type: "room.opening.changed", opening: message.opening });
        await this.scheduleCopy();
        return;
      default:
        return REFUSALS.unsupported;
    }
  }

  /** Access refresh, the durable copy's retries, and erasure once the day's retention is over. */
  async alarm(): Promise<void> {
    const { access, ctx, env, store } = this.parts;
    const state = store.state();
    if (!state) return;
    const endAt = store.endsAt(state);
    const purgeAt = liveRoomPurgeAt(endAt);
    const pending = store.pendingCopy();
    await access.refresh();
    await this.syncAccess();
    if (pending) {
      try {
        await copyLiveLocationChatToD1(env.DB, pending);
        store.markCopied(pending);
      } catch (error) {
        console.error("Live location chat copy failed", error);
      }
    }
    if (Date.now() >= purgeAt && !store.pendingCopy()) return this.parts.purge();
    const next = [purgeAt];
    if (store.pendingCopy()) next.push(this.copyDue());
    const accessAt = access.nextRefreshAt();
    if (accessAt !== null) next.push(accessAt);
    await ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...next)));
  }

  private copyDue(): number {
    return Date.now() + LIVE_ROOM_POLICY.durableCopyDelaySeconds * 1000;
  }

  async scheduleCopy(): Promise<void> {
    await this.setAlarmBy(this.copyDue());
  }

  private async scheduleAlarm(): Promise<void> {
    const { access, store } = this.parts;
    const state = store.state();
    if (!state) return;
    const at = [liveRoomPurgeAt(store.endsAt(state))];
    const refreshAt = access.nextRefreshAt();
    if (refreshAt !== null) at.push(refreshAt);
    await this.setAlarmBy(Math.min(...at));
  }

  private async setAlarmBy(at: number): Promise<void> {
    const current = await this.parts.ctx.storage.getAlarm();
    if (current === null || current > at) await this.parts.ctx.storage.setAlarm(at);
  }
}
