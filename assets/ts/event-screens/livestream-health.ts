/**
 * How a livestream screen judges its player. The stream runs at all times,
 * breaks included, so anything but playing is a fault once it lasts: an
 * error or the end of the stream at once, buffering or not starting after a
 * minute. A fault shows the reconnecting card and recreates the player with
 * backoff until it plays again. A player the browser will not start with
 * sound starts muted instead; the next player tries with sound again. Only a fault or another video recreates the
 * player; nothing the server says or fails to say does.
 */
import { LIVESTREAM_PLAYER_STATES, SCREEN_PLAYER_STATUSES } from "../../shared/schemas/event-screen-monitor";

export const LIVESTREAM_HEALTH_POLICY = {
  /** Buffering, paused or not started for this long counts as a fault. */
  stallMs: 60_000,
  /** The first retry waits this long; each later one twice as long, up to the cap. */
  retryFirstMs: 5_000,
  retryMaxMs: 60_000,
} as const;

/** What the player is doing, as the screen reports it. */
export type LivestreamPlayerStatus = (typeof SCREEN_PLAYER_STATUSES)[number];

export interface LivestreamHealth {
  videoId: string;
  status: LivestreamPlayerStatus;
  /** When the status or the video last changed. */
  changedAt: number;
  /** Playing without sound because the browser refused to start it with sound. */
  muted: boolean;
  /** From a fault until the player plays again. */
  reconnecting: boolean;
  /** Since when the player has not been playing; null while it plays or after a fault. */
  stalledSince: number | null;
  /** Faults since the player last played, for the backoff. */
  faults: number;
  /** When to recreate the player after a fault. */
  retryAt: number | null;
  /** Changes whenever the player must be created anew. */
  generation: number;
}

/** The player's own states, as the screen hears them. */
export type LivestreamPlayerState = (typeof LIVESTREAM_PLAYER_STATES)[number];

export type LivestreamHealthEvent =
  | { type: "video"; videoId: string; at: number }
  | { type: "state"; state: LivestreamPlayerState; at: number }
  | { type: "fault"; at: number }
  | { type: "muted"; at: number }
  | { type: "unmuted"; at: number }
  | { type: "tick"; at: number };

/** An event as its source reports it, before the screen stamps the time. */
export type LivestreamHealthSignal = LivestreamHealthEvent extends infer Event
  ? Event extends LivestreamHealthEvent
    ? Omit<Event, "at">
    : never
  : never;

export function livestreamRetryDelay(faults: number): number {
  return Math.min(LIVESTREAM_HEALTH_POLICY.retryMaxMs, LIVESTREAM_HEALTH_POLICY.retryFirstMs * 2 ** faults);
}

/** A new player for a video: loading, counting toward a stall until it plays. */
export function startLivestreamHealth(videoId: string, at: number, generation = 0): LivestreamHealth {
  return {
    videoId,
    status: "loading",
    changedAt: at,
    muted: false,
    reconnecting: false,
    stalledSince: at,
    faults: 0,
    retryAt: null,
    generation,
  };
}

function withStatus(health: LivestreamHealth, status: LivestreamPlayerStatus, at: number): LivestreamHealth {
  return status === health.status ? health : { ...health, status, changedAt: at };
}

function fault(health: LivestreamHealth, at: number): LivestreamHealth {
  // A player already waiting to be recreated has nothing more to fail.
  if (health.retryAt !== null) return health;
  return {
    ...withStatus(health, "error", at),
    reconnecting: true,
    stalledSince: null,
    faults: health.faults + 1,
    retryAt: at + livestreamRetryDelay(health.faults),
  };
}

export function nextLivestreamHealth(health: LivestreamHealth, event: LivestreamHealthEvent): LivestreamHealth {
  switch (event.type) {
    case "video":
      return event.videoId === health.videoId
        ? health
        : startLivestreamHealth(event.videoId, event.at, health.generation + 1);
    case "fault":
      return fault(health, event.at);
    case "muted":
      return health.muted || health.retryAt !== null ? health : { ...health, muted: true, changedAt: event.at };
    case "unmuted":
      // Someone turned the sound on themselves: the player plays with sound, not because a refusal was lifted.
      return health.muted ? { ...health, muted: false, changedAt: event.at } : health;
    case "tick":
      if (health.retryAt !== null)
        return event.at < health.retryAt
          ? health
          : {
              // Each new player tries with sound again.
              ...withStatus(health, "loading", event.at),
              muted: false,
              stalledSince: event.at,
              retryAt: null,
              generation: health.generation + 1,
            };
      return health.stalledSince !== null && event.at - health.stalledSince >= LIVESTREAM_HEALTH_POLICY.stallMs
        ? fault(health, event.at)
        : health;
    case "state": {
      // A player waiting to be recreated is no longer listened to.
      if (health.retryAt !== null) return health;
      if (event.state === "ended") return fault(health, event.at);
      if (event.state === "playing")
        return { ...withStatus(health, "playing", event.at), reconnecting: false, stalledSince: null, faults: 0 };
      const stalled = { ...health, stalledSince: health.stalledSince ?? event.at };
      // Not started yet is still loading; once started, anything but playing is buffering.
      return health.status === "loading" && (event.state === "unstarted" || event.state === "cued")
        ? stalled
        : withStatus(stalled, "buffering", event.at);
    }
  }
}
