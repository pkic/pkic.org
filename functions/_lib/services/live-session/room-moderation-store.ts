import {
  livePauseEndsAt,
  liveRestrictionActive,
  type LiveModerationReason,
  type LiveModerationTarget,
  type LiveParticipationBlock,
  type LiveParticipationRestriction,
} from "../../../../assets/shared/live-moderation-policy";
import type { LiveRoomSql } from "./room-sql";
import type { LiveEventBlockDecision } from "./room-occurrence-participation";

export interface LiveRemovalRow {
  item_id: string;
  kind: LiveModerationTarget;
  reason: LiveModerationReason;
  by_user_id: string;
  by_name: string;
  at: string;
}

export interface LiveDoneRow {
  item_id: string;
  by_name: string;
  at: string;
}

const BLOCK_RANK: Record<LiveParticipationBlock, number> = { paused: 0, session: 1, event: 2 };

function idList(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/**
 * What moderators decided in one room, the same for chat, questions and
 * answers: removals with their reason, the studio's Done flag, and who is
 * kept from posting. Event blocks live in D1; the room holds the people it
 * last read as blocked so every check stays synchronous.
 */
export class LiveRoomModerationStore {
  constructor(private readonly sql: LiveRoomSql) {}

  removals(ids: readonly string[]): Map<string, LiveRemovalRow> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<LiveRemovalRow>(
          "SELECT item_id, kind, reason, by_user_id, by_name, at FROM room_removals WHERE item_id IN (SELECT value FROM json_each(?))",
          idList(ids),
        )
        .map((row) => [row.item_id, row]),
    );
  }

  removal(id: string): LiveRemovalRow | null {
    return this.removals([id]).get(id) ?? null;
  }

  remove(
    kind: LiveModerationTarget,
    id: string,
    reason: LiveModerationReason,
    by: { userId: string; name: string },
    at: string,
  ): void {
    this.sql.exec(
      `INSERT INTO room_removals(item_id, kind, reason, by_user_id, by_name, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET reason = excluded.reason, by_user_id = excluded.by_user_id,
         by_name = excluded.by_name, at = excluded.at`,
      id,
      kind,
      reason,
      by.userId,
      by.name,
      at,
    );
  }

  restore(id: string): void {
    this.sql.exec("DELETE FROM room_removals WHERE item_id = ?", id);
  }

  done(ids: readonly string[]): Map<string, LiveDoneRow> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<LiveDoneRow>(
          "SELECT item_id, by_name, at FROM room_done WHERE item_id IN (SELECT value FROM json_each(?))",
          idList(ids),
        )
        .map((row) => [row.item_id, row]),
    );
  }

  setDone(kind: LiveModerationTarget, id: string, done: boolean, byName: string, at: string): void {
    if (!done) {
      this.sql.exec("DELETE FROM room_done WHERE item_id = ?", id);
      return;
    }
    this.sql.exec(
      "INSERT INTO room_done(item_id, kind, by_name, at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id) DO NOTHING",
      id,
      kind,
      byName,
      at,
    );
  }

  /** Each person's strongest block in force at `now`; people free to post are absent. */
  restrictions(userIds: readonly string[], now: number): Map<string, LiveParticipationRestriction> {
    const restrictions = new Map<string, LiveParticipationRestriction>();
    if (!userIds.length) return restrictions;
    const rows = [
      ...this.sql.rows<{ user_id: string; block: LiveParticipationBlock; until: string | null }>(
        "SELECT user_id, block, until FROM room_participation_blocks WHERE user_id IN (SELECT value FROM json_each(?))",
        idList(userIds),
      ),
      ...this.sql
        .rows<{ user_id: string }>(
          "SELECT user_id FROM room_event_blocks WHERE user_id IN (SELECT value FROM json_each(?))",
          idList(userIds),
        )
        .map((row) => ({ user_id: row.user_id, block: "event" as const, until: null })),
    ];
    for (const row of rows) {
      const restriction = { block: row.block, until: row.until };
      if (!liveRestrictionActive(restriction, now)) continue;
      const current = restrictions.get(row.user_id);
      if (!current || BLOCK_RANK[row.block] > BLOCK_RANK[current.block]) restrictions.set(row.user_id, restriction);
    }
    return restrictions;
  }

  blockedUserIds(at: string): string[] {
    return this.sql
      .rows<{ user_id: string }>(
        "SELECT user_id FROM room_participation_blocks WHERE until IS NULL OR until > ? UNION SELECT user_id FROM room_event_blocks",
        at,
      )
      .map(({ user_id }) => user_id);
  }

  restriction(userId: string | null, now: number): LiveParticipationRestriction | null {
    if (!userId) return null;
    return this.restrictions([userId], now).get(userId) ?? null;
  }

  /**
   * A pause or a session block, kept in the room; a later pause never weakens a session block.
   * An event block goes to D1 and reaches the room through `eventBlocked`.
   */
  block(
    userId: string,
    block: Exclude<LiveParticipationBlock, "event">,
    reason: LiveModerationReason,
    by: { userId: string; name: string },
    at: string,
  ): void {
    this.sql.exec(
      `INSERT INTO room_participation_blocks(user_id, block, reason, until, by_user_id, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET block = excluded.block, reason = excluded.reason, until = excluded.until,
         by_user_id = excluded.by_user_id, by_name = excluded.by_name, at = excluded.at
       WHERE NOT (room_participation_blocks.block = 'session' AND excluded.block = 'paused')`,
      userId,
      block,
      reason,
      block === "paused" ? livePauseEndsAt(at) : null,
      by.userId,
      by.name,
      at,
    );
  }

  /** Lifts the room's own block; an event block is lifted in D1 and then dropped here. */
  lift(userId: string): void {
    this.sql.exec("DELETE FROM room_participation_blocks WHERE user_id = ?", userId);
  }

  /**
   * As of when the room's event decision for someone holds: the decision's time, or the D1 read that last
   * confirmed it. A notice or a read older than that is stale and leaves the room's decision as it is.
   */
  private readonly eventKnownAt = new Map<string, number>();

  /** An organizer's decision, already written to D1; one older than what the room already knows is ignored. */
  decideEventBlock(userId: string, decision: LiveEventBlockDecision): void {
    if ((this.eventKnownAt.get(userId) ?? -Infinity) > decision.at) return;
    this.eventKnownAt.set(userId, decision.at);
    this.eventBlocked(userId, decision.blocked);
  }

  /** Whether the room holds its own event decision for someone, which outranks another room's copy of it. */
  knowsEventDecision(userId: string): boolean {
    return this.eventKnownAt.has(userId);
  }

  private eventBlocked(userId: string, blocked: boolean): void {
    if (blocked) this.sql.exec("INSERT OR IGNORE INTO room_event_blocks(user_id) VALUES (?)", userId);
    else this.sql.exec("DELETE FROM room_event_blocks WHERE user_id = ?", userId);
  }

  /**
   * Replaces what the room knows of event blocks for the people D1 was just
   * asked about. Returns everyone whose event block started or ended.
   */
  refreshEventBlocks(checked: readonly string[], blocked: ReadonlySet<string>, readAt: number): string[] {
    checked = checked.filter((userId) => (this.eventKnownAt.get(userId) ?? -Infinity) < readAt);
    for (const userId of checked) this.eventKnownAt.set(userId, readAt);
    if (!checked.length) return [];
    const before = new Set(
      this.sql
        .rows<{ user_id: string }>(
          "SELECT user_id FROM room_event_blocks WHERE user_id IN (SELECT value FROM json_each(?))",
          idList(checked),
        )
        .map((row) => row.user_id),
    );
    const changed = checked.filter((userId) => before.has(userId) !== blocked.has(userId));
    for (const userId of changed) this.eventBlocked(userId, blocked.has(userId));
    return changed;
  }

  forget(userId: string): void {
    this.sql.exec("DELETE FROM room_participation_blocks WHERE user_id = ?", userId);
    this.sql.exec("DELETE FROM room_event_blocks WHERE user_id = ?", userId);
  }
}
