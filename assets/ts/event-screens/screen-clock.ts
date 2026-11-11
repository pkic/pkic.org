/** How many recent samples the clock chooses its offset from. */
export const SCREEN_CLOCK_SAMPLES = 8;

export interface ScreenClockSample {
  /** The server's clock minus the device's, at the request's midpoint. */
  offsetMs: number;
  roundTripMs: number;
}

/**
 * The offset one read measures: the server stamped `serverNow` somewhere in
 * the round trip, so the midpoint of the request is the best guess at when.
 */
export function screenClockSample(sentAt: number, receivedAt: number, serverNow: string): ScreenClockSample | null {
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server) || receivedAt < sentAt) return null;
  return { offsetMs: server - (sentAt + receivedAt) / 2, roundTripMs: receivedAt - sentAt };
}

/** The offset of the shortest round trip among the recent samples, which carries the least uncertainty. */
export function screenClockOffset(samples: readonly ScreenClockSample[]): number {
  let best: ScreenClockSample | null = null;
  for (const sample of samples.slice(-SCREEN_CLOCK_SAMPLES))
    if (!best || sample.roundTripMs < best.roundTripMs) best = sample;
  return best?.offsetMs ?? 0;
}

/** The device's clock corrected to the server's, for every countdown on the screen. */
export function createScreenClock(device: () => number = () => Date.now()) {
  let samples: ScreenClockSample[] = [];
  let offset = 0;
  return {
    now: () => device() + offset,
    record(sample: ScreenClockSample | null) {
      if (!sample) return;
      samples = [...samples, sample].slice(-SCREEN_CLOCK_SAMPLES);
      offset = screenClockOffset(samples);
    },
  };
}
export type ScreenClock = ReturnType<typeof createScreenClock>;
