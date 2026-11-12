/**
 * What a livestream screen reports of YouTube's own player: its state, the
 * stalls of the last minute and hour, its last error, how much it buffered,
 * the quality it says it plays and how far behind live it runs. Read at each
 * health report, never pushed, so these readings do not make the screen
 * report more often.
 */
import type { ScreenPlayback } from "../../shared/schemas/event-screen-monitor";
import type { LivestreamPlayerState, LivestreamPlayerStatus } from "./livestream-health";
import { YOUTUBE_PLAYER_STATES, type YouTubePlayer } from "./youtube-iframe-api";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const PLAYER_STATES = new Map<number, LivestreamPlayerState>(
  Object.entries(YOUTUBE_PLAYER_STATES).map(([name, value]) => [value, name as LivestreamPlayerState]),
);

export function livestreamPlayerState(code: number): LivestreamPlayerState | null {
  return PLAYER_STATES.get(code) ?? null;
}

interface Stall {
  start: number;
  end: number | null;
}

/**
 * The player's stalls: from leaving playing until it plays again, through any
 * error and new player in between. The first start is not a stall.
 */
export class LivestreamStallLog {
  private stalls: Stall[] = [];
  private playing = false;
  /** Every stall since this log began; never pruned. */
  started = 0;

  status(status: LivestreamPlayerStatus, at: number): void {
    const open = this.stalls.at(-1);
    if (status === "playing") {
      if (open && open.end === null) open.end = at;
      this.playing = true;
      return;
    }
    if (this.playing) {
      this.stalls.push({ start: at, end: null });
      this.started += 1;
    }
    this.playing = false;
    this.stalls = this.stalls.filter((stall) => stall.end === null || stall.end > at - HOUR_MS);
  }

  /** Stalls that started in the window, and the seconds of the window spent stalled. */
  summary(now: number, windowMs: number): { count: number; seconds: number } {
    const since = now - windowMs;
    let count = 0;
    let stalledMs = 0;
    for (const stall of this.stalls) {
      const end = stall.end ?? now;
      if (end <= since) continue;
      if (stall.start >= since) count += 1;
      stalledMs += end - Math.max(stall.start, since);
    }
    return { count, seconds: Math.round(Math.min(stalledMs, windowMs) / 100) / 10 };
  }
}

function read<T>(call: (() => T) | undefined): T | null {
  try {
    return call ? call() : null;
  } catch {
    return null;
  }
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Behind the live edge, only while YouTube says the video is live: elsewhere the same sum is the time left. */
export function liveLag(player: YouTubePlayer): number | null {
  if (read(() => player.getVideoData?.())?.isLive !== true) return null;
  const duration = read(() => player.getDuration?.());
  const current = read(() => player.getCurrentTime?.());
  if (!finite(duration) || !finite(current) || duration <= 0) return null;
  const lag = duration - current;
  return lag >= 0 && lag <= 86_400 ? Math.round(lag * 10) / 10 : null;
}

/** The player's readings now; a player not yet ready gives only the stalls and the last error. */
export function livestreamPlayback(input: {
  player: YouTubePlayer | null;
  stalls: LivestreamStallLog;
  errorCode: number | null;
  now: number;
}): ScreenPlayback {
  const { player, now } = input;
  const state = player ? read(() => player.getPlayerState?.()) : null;
  const loaded = player ? read(() => player.getVideoLoadedFraction?.()) : null;
  const quality = player ? read(() => player.getPlaybackQuality?.()) : null;
  return {
    state: finite(state) ? livestreamPlayerState(state) : null,
    stalls: {
      lastMinute: input.stalls.summary(now, MINUTE_MS),
      lastHour: input.stalls.summary(now, HOUR_MS),
      started: input.stalls.started,
    },
    errorCode: input.errorCode,
    loadedFraction: finite(loaded) ? Math.min(1, Math.max(0, Math.round(loaded * 1000) / 1000)) : null,
    reportedQuality: typeof quality === "string" && quality ? quality.slice(0, 32) : null,
    liveLagSeconds: player ? liveLag(player) : null,
  };
}
