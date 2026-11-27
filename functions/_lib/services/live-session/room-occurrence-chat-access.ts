import { liveRoomPurgeAt } from "../../../../assets/shared/live-session-policy";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import type { Env } from "../../types";
import { liveLocationChatName } from "./room-admission";
import type { LiveRoomModerationStore } from "./room-moderation-store";
import type { LiveRoomSql } from "./room-sql";
import type { LiveRoomStore } from "./room-store";
import type {
  LiveEventBlockDecision,
  LiveOccurrenceModerationChange,
  LiveOccurrenceParticipation,
} from "./room-occurrence-participation";

const MODERATION_PURGE_AT = "occurrence-moderation-purge-at";

/** The occurrence's own controls, used by both the occurrence and its location chat. */
export class LiveOccurrenceChatAccess {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Pick<Env, "LIVE_SESSION_ROOMS">,
    private readonly sql: LiveRoomSql,
    private readonly store: LiveRoomStore,
    private readonly decisions: LiveRoomModerationStore,
    private readonly changed: (userId: string, decision?: LiveEventBlockDecision) => Promise<void>,
    private readonly scheduleAlarm: (at: number) => Promise<void>,
  ) {}

  read(userId: string): LiveOccurrenceParticipation {
    if (!this.sql.holdsData()) return { opening: "scheduled", restriction: null };
    return { opening: this.store.opening(), restriction: this.decisions.restriction(userId, Date.now()) };
  }

  restrictions(userIds: string[]) {
    return this.sql.holdsData() ? Object.fromEntries(this.decisions.restrictions(userIds, Date.now())) : {};
  }

  async resumePurge(purge: () => Promise<void>): Promise<boolean> {
    const at = await this.ctx.storage.get<number>(MODERATION_PURGE_AT);
    if (at === undefined) return false;
    if (Date.now() >= at) await purge();
    else await this.ctx.storage.setAlarm(at);
    return true;
  }

  async change(
    userId: string,
    endsAt: string,
    change: LiveOccurrenceModerationChange,
  ): Promise<LiveOccurrenceParticipation> {
    if (change.kind === "event") {
      if (!this.sql.holdsData()) return this.read(userId);
      this.decisions.decideEventBlock(userId, change.decision);
      if (this.store.session()) this.ctx.waitUntil(this.changed(userId, change.decision));
      return this.read(userId);
    }
    const current = this.read(userId);
    const purgeAt = liveRoomPurgeAt(endsAt);
    if (Date.now() >= purgeAt || (change.kind === "lift" && current.restriction?.block === "event")) return current;
    if (change.kind === "lift") {
      if (current.restriction) this.decisions.lift(userId);
    } else {
      this.decisions.block(userId, change.block, change.reason, change.actor, change.at);
    }
    if (this.store.session()) {
      this.ctx.waitUntil(this.changed(userId));
    } else if (change.kind === "block") {
      await this.ctx.storage.put(MODERATION_PURGE_AT, purgeAt);
      await this.scheduleAlarm(purgeAt);
    }
    return this.read(userId);
  }

  /** Tells the occurrence's location chats; an event decision made here goes with it, so they need not wait for D1. */
  notify(userId: string | null, decision?: LiveEventBlockDecision): void {
    const room = this.store.session();
    const rooms = this.env.LIVE_SESSION_ROOMS;
    if (!room || !rooms) return;
    const session = room.session;
    const day = instantToCalendarDate(session.startAt, session.timeZone);
    for (const roomId of this.store.chatLocations(session.roomId)) {
      this.ctx.waitUntil(
        rooms
          .getByName(liveLocationChatName(room.eventId, roomId, day))
          .locationChatAccessChanged(session.occurrenceId, userId, decision)
          .catch((error: unknown) => console.error("Live location chat access notice failed", error)),
      );
    }
  }
}
