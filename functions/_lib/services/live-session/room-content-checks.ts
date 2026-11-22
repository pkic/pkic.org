/**
 * Automatic checks of what attendees write in a live room. The event's check
 * settings are read once and kept for a short while, so a chat message or a
 * question costs the model call alone, never a database read of its own.
 */
import type { ContentCheckKind, EffectiveContentCheck } from "../../../../assets/shared/content-checks";
import type { DatabaseLike, Env } from "../../types";
import { logError } from "../../logging";
import { runContentCheck, type ContentCheckRun } from "../content-checks/model";
import { readEffectiveContentCheck } from "../content-checks/settings";
import { contentCheckState } from "../content-checks/state";
import type { LiveLocationChatStore } from "./location-chat-store";
import { liveRoomChatScope } from "./room-chat-scope";
import type { LiveRoomStore } from "./room-store";

/** How long a room keeps an event's check settings before it reads them again. */
export const LIVE_CONTENT_CHECK_SETTINGS_TTL_MS = 2 * 60 * 1000;
/** A live check that takes longer is given up: the message goes on unchecked rather than waiting. */
const LIVE_CONTENT_CHECK_TIMEOUT_MS = 4000;

type LiveCheckKind = Extract<ContentCheckKind, "chat_message" | "audience_question">;

interface CachedCheck {
  eventId: string;
  check: EffectiveContentCheck;
  readAt: number;
}

export class LiveRoomContentChecks {
  private readonly cached = new Map<LiveCheckKind, CachedCheck>();

  constructor(
    private readonly env: Pick<Env, "AI"> & { DB: DatabaseLike },
    private readonly store: LiveRoomStore,
    private readonly location: LiveLocationChatStore,
  ) {}

  /** The event whose settings apply: the session's, or the location chat's between sessions. */
  private eventId(): string | null {
    return liveRoomChatScope(this.store, this.location)?.eventId ?? null;
  }

  /** Whether a check may run, as far as the room knows without reading: unknown settings count as on. */
  mayRun(kind: LiveCheckKind): boolean {
    if (!this.env.AI) return false;
    const cached = this.cached.get(kind);
    return !cached || cached.eventId !== this.eventId() || cached.check.enabled;
  }

  private async settings(kind: LiveCheckKind, now: number): Promise<EffectiveContentCheck | null> {
    const eventId = this.eventId();
    if (!eventId) return null;
    const cached = this.cached.get(kind);
    if (cached && cached.eventId === eventId && now - cached.readAt < LIVE_CONTENT_CHECK_SETTINGS_TTL_MS)
      return cached.check;
    try {
      const check = await readEffectiveContentCheck(this.env.DB, eventId, kind);
      this.cached.set(kind, { eventId, check, readAt: now });
      return check;
    } catch (error) {
      logError("LIVE_CONTENT_CHECK_SETTINGS_FAILED", { reason: error instanceof Error ? error.message : "unknown" });
      return cached?.eventId === eventId ? cached.check : null;
    }
  }

  /** Checks one text; null when no check runs for it, so nothing waits on one. */
  async run(kind: LiveCheckKind, text: string, now = Date.now()): Promise<ContentCheckRun | null> {
    if (!this.env.AI) return null;
    const check = await this.settings(kind, now);
    if (!check?.enabled || !check.questions.length) return null;
    return runContentCheck(this.env, check, contentCheckState(kind, { text }), {
      timeoutMs: LIVE_CONTENT_CHECK_TIMEOUT_MS,
    });
  }
}
