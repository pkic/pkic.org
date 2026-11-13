/** The longest a persistent live connection waits before it tries again. */
export const LIVE_PERSISTENT_RETRY_MAX_MS = 30_000;

/**
 * How long a persistent connection (a venue screen) waits before its next
 * attempt: doubling from a second up to the cap, each wait drawn from its
 * upper half, so a venue's screens never reconnect in step after an outage.
 */
export function persistentRetryDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(LIVE_PERSISTENT_RETRY_MAX_MS, 1000 * 2 ** Math.max(0, Math.min(attempt, 5)));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * A connection that never gives up: it retries after refusals and failures
 * alike, reports refusals so its page can renew access or follow a change,
 * and reports every server message, keep-alive replies included, so its page
 * knows how old its picture is.
 */
export interface LivePersistence {
  onRefusal?: (code: string) => void;
  onActivity?: () => void;
  /** A message this page cannot read: the server runs a newer release than the page. */
  onUnreadable?: () => void;
}
