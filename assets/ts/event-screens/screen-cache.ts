import { z } from "zod";
import { utcInstantSchema } from "../../shared/schemas/api-common";
import {
  screenAgendaSchema,
  screenAgendaSessionSchema,
  screenOwnViewSchema,
  type ScreenAgenda,
  type ScreenId,
  type ScreenOwnView,
} from "../../shared/schemas/event-screens";
import { liveRoomSnapshotSchema } from "../../shared/schemas/live-session-room";
import { SCREEN_POLICY } from "../../shared/event-screen-policy";
import { applyLiveRoomMessage, type LiveRoomState } from "../live-session/live-room-state";

/** The most a screen keeps on the device; past it the live picture is dropped, then the whole copy. */
export const SCREEN_CACHE_MAX_BYTES = 512 * 1024;

/**
 * What a screen keeps on the device so it shows its last good state at once
 * after a restart and can run its room's agenda while offline. The overlay
 * access is never kept: it is short-lived and comes with each read.
 */
export const screenCacheSchema = z
  .object({
    version: z.literal(1),
    savedAt: utcInstantSchema,
    view: screenOwnViewSchema.safeExtend({ overlay: z.null(), agenda: z.null() }),
    agenda: screenAgendaSchema
      .safeExtend({ sessions: z.array(screenAgendaSessionSchema).max(SCREEN_POLICY.agendaMaxSessions) })
      .nullable(),
    live: z.object({ snapshot: liveRoomSnapshotSchema }).strict().nullable(),
  })
  .strict();
export type ScreenCache = z.infer<typeof screenCacheSchema>;
export type ScreenCachedAgenda = NonNullable<ScreenCache["agenda"]>;

export const screenCacheKey = (screenId: ScreenId) => `pkic.screen.${screenId}`;

/** The device's copy, or null when there is none or it no longer passes the contract (then it is removed). */
export function readScreenCache(storage: Storage, screenId: ScreenId): ScreenCache | null {
  const key = screenCacheKey(screenId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: z.ZodSafeParseResult<ScreenCache> | null = null;
  if (raw.length <= SCREEN_CACHE_MAX_BYTES) {
    try {
      parsed = screenCacheSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
  }
  if (parsed?.success && parsed.data.view.screen.id === screenId) return parsed.data;
  try {
    storage.removeItem(key);
  } catch {
    /* A device that cannot forget the copy reads it as missing. */
  }
  return null;
}

/** Keeps the copy within the bound: without the live picture when it is too large, not at all when still too large. */
export function writeScreenCache(storage: Storage, cache: ScreenCache): boolean {
  const key = screenCacheKey(cache.view.screen.id);
  for (const candidate of [cache, { ...cache, live: null }]) {
    const serialized = JSON.stringify(candidate);
    if (serialized.length > SCREEN_CACHE_MAX_BYTES) continue;
    try {
      storage.setItem(key, serialized);
      return true;
    } catch {
      /* Storage full or unavailable: try the smaller copy. */
    }
  }
  return false;
}

/** The read as the device keeps it: without its overlay access and its agenda, which is kept merged on its own. */
export function cachedScreenView(view: ScreenOwnView): ScreenCache["view"] {
  return { ...view, overlay: null, agenda: null };
}

/**
 * The agenda after a read: the read's sessions when it sent them, the kept
 * ones when it said the revision is unchanged, nothing once unassigned.
 */
export function mergeScreenAgenda(
  kept: ScreenCachedAgenda | null,
  read: ScreenAgenda | null,
): ScreenCachedAgenda | null {
  if (!read) return null;
  if (read.sessions) return { ...read, sessions: read.sessions };
  return kept && kept.revision === read.revision ? { ...read, sessions: kept.sessions } : null;
}

/** The revision to send with the next read: only while the kept copy still covers the next day. */
export function screenAgendaRevision(kept: ScreenCachedAgenda | null, now: number): number | null {
  if (!kept) return null;
  const coveredMs = Date.parse(kept.to) - now;
  return coveredMs > (SCREEN_POLICY.agendaHoursAfter - SCREEN_POLICY.agendaHoursBefore) * 3_600_000
    ? kept.revision
    : null;
}

/** The live picture as the device keeps it, a room snapshot without its transient parts. */
export function cachedLiveSnapshot(state: LiveRoomState): NonNullable<ScreenCache["live"]> {
  const { thread: _thread, burst: _burst, refusal: _refusal, ...snapshot } = state;
  return { snapshot: { type: "room.snapshot", ...snapshot } };
}

export function liveStateFromCache(live: ScreenCache["live"]): LiveRoomState | null {
  return live ? applyLiveRoomMessage(null, live.snapshot) : null;
}
