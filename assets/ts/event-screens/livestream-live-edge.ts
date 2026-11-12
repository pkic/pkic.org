/**
 * Keeping a livestream player at the live edge. A player that falls behind
 * live, after buffering or a slow network, stays behind: YouTube resumes
 * where it stopped. A monitor that must show what is on air now seeks back
 * to the edge, but only once it has been behind for a moment, never twice in
 * quick succession, and it stops trying for a while when the stream itself
 * keeps falling behind, so a slow connection never turns into a stutter of
 * seeks.
 */

export const LIVESTREAM_LIVE_EDGE_POLICY = {
  /** Further behind live than this, in seconds, is behind; YouTube's own buffer at the edge stays under it. */
  behindSeconds: 10,
  /** Behind this long without a moment back at the edge before the player seeks. */
  sustainMs: 3_000,
  /** At least this long between two seeks, so a seek has time to settle. */
  cooldownMs: 30_000,
  /** This many seeks within the window, and the player stops seeking until the oldest leaves the window. */
  maxSeeks: 3,
  windowMs: 5 * 60_000,
} as const;

export interface LivestreamLiveEdge {
  /** Since when the player has been behind; null while it is at the edge or not playing. */
  behindSince: number | null;
  /** When the player sought to the edge within the window, oldest first. */
  seeks: readonly number[];
}

export const LIVESTREAM_AT_LIVE_EDGE: LivestreamLiveEdge = { behindSince: null, seeks: [] };

/** One reading of the player: how far behind live it plays, when YouTube says so, and whether it plays. */
export interface LivestreamLiveEdgeReading {
  lagSeconds: number | null;
  playing: boolean;
  at: number;
}

/** What the player knows after a reading, and whether it should seek to the live edge now. */
export function nextLivestreamLiveEdge(
  edge: LivestreamLiveEdge,
  reading: LivestreamLiveEdgeReading,
): { edge: LivestreamLiveEdge; seek: boolean } {
  const policy = LIVESTREAM_LIVE_EDGE_POLICY;
  const seeks = edge.seeks.filter((at) => at > reading.at - policy.windowMs);
  // Buffering, paused or not live: the health check owns those; only a playing live stream is behind.
  if (!reading.playing || reading.lagSeconds === null || reading.lagSeconds <= policy.behindSeconds)
    return { edge: { behindSince: null, seeks }, seek: false };
  const behindSince = edge.behindSince ?? reading.at;
  const last = seeks.at(-1);
  const due =
    reading.at - behindSince >= policy.sustainMs &&
    (last === undefined || reading.at - last >= policy.cooldownMs) &&
    seeks.length < policy.maxSeeks;
  return due
    ? { edge: { behindSince: null, seeks: [...seeks, reading.at] }, seek: true }
    : { edge: { behindSince, seeks }, seek: false };
}
