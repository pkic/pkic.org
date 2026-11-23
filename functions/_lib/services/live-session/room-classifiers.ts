/**
 * Classifiers of what attendees write in a live room. The event's check
 * settings are read once and kept for a short while, so a chat message or a
 * question costs the model call alone, never a database read of its own.
 */
import type { ClassifierKind, EffectiveClassifier } from "../../../../assets/shared/classifiers";
import type { DatabaseLike, Env } from "../../types";
import { logError } from "../../logging";
import { runClassifier, type ClassifierRun } from "../classifiers/model";
import { readEffectiveClassifier } from "../classifiers/settings";
import { classifierState } from "../classifiers/state";
import type { LiveLocationChatStore } from "./location-chat-store";
import { liveRoomChatScope } from "./room-chat-scope";
import type { LiveRoomStore } from "./room-store";

/** How long a room keeps an event's check settings before it reads them again. */
export const LIVE_CLASSIFIER_SETTINGS_TTL_MS = 2 * 60 * 1000;
/** A live check that takes longer is given up: the message goes on unchecked rather than waiting. */
const LIVE_CLASSIFIER_TIMEOUT_MS = 4000;

type LiveCheckKind = Extract<ClassifierKind, "chat" | "question">;

interface CachedCheck {
  eventId: string;
  check: EffectiveClassifier;
  readAt: number;
}

export class LiveRoomClassifiers {
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
  mayRun(kind: LiveCheckKind, now = Date.now()): boolean {
    if (!this.env.AI) return false;
    const cached = this.cached.get(kind);
    // Settings that are off count as off only while fresh: run() must read them again to notice they were enabled.
    return (
      !cached ||
      cached.eventId !== this.eventId() ||
      now - cached.readAt >= LIVE_CLASSIFIER_SETTINGS_TTL_MS ||
      cached.check.enabled
    );
  }

  private async settings(kind: LiveCheckKind, now: number): Promise<EffectiveClassifier | null> {
    const eventId = this.eventId();
    if (!eventId) return null;
    const cached = this.cached.get(kind);
    if (cached && cached.eventId === eventId && now - cached.readAt < LIVE_CLASSIFIER_SETTINGS_TTL_MS)
      return cached.check;
    try {
      const check = await readEffectiveClassifier(this.env.DB, eventId, kind);
      this.cached.set(kind, { eventId, check, readAt: now });
      return check;
    } catch (error) {
      logError("LIVE_CLASSIFIER_SETTINGS_FAILED", { reason: error instanceof Error ? error.message : "unknown" });
      return cached?.eventId === eventId ? cached.check : null;
    }
  }

  /** Checks one text; null when no check runs for it, so nothing waits on one. */
  async run(kind: LiveCheckKind, text: string, now = Date.now()): Promise<ClassifierRun | null> {
    if (!this.env.AI) return null;
    const check = await this.settings(kind, now);
    if (!check?.enabled || !check.questions.length) return null;
    return runClassifier(this.env, check, classifierState(kind, { text }), {
      timeoutMs: LIVE_CLASSIFIER_TIMEOUT_MS,
    });
  }
}
