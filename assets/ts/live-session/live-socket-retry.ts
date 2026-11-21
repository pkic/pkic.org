import { noteSessionPresence } from "../shared/session-presence";

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

/** How often a live connection asks the server whether it is still there. */
export const LIVE_KEEP_ALIVE_MS = 10_000;
/** How long one of those questions may go unanswered before the connection counts as lost. */
export const LIVE_SILENCE_MS = 20_000;

/**
 * Keeps one open socket honest: asks the server whether it is there, and
 * reports the socket lost once a question goes unanswered too long, which a
 * network that changed or a computer that slept never announces with a
 * close. It times only a question still waiting for its answer, so a page
 * in the background, whose timers the browser runs a minute late, keeps a
 * connection that answers. Back online or shown again, it asks at once.
 * `heard` marks every message, which also says the person is still there;
 * `stop` ends the watch.
 */
export function watchLiveSocket(
  socket: WebSocket,
  lost: () => void,
  clock: { now: () => number } = Date,
): { heard: () => void; stop: () => void } {
  let asked: number | null = null;
  const check = () => {
    if (asked !== null) {
      if (clock.now() - asked >= LIVE_SILENCE_MS) lost();
      return;
    }
    try {
      socket.send("ping");
      asked = clock.now();
    } catch {
      lost();
    }
  };
  const timer = setInterval(check, LIVE_KEEP_ALIVE_MS);
  const unsubscribe = retryWhenBack(() => (socket.readyState === WebSocket.OPEN ? check() : lost()));
  return {
    heard: () => {
      asked = null;
      noteSessionPresence();
    },
    stop: () => {
      clearInterval(timer);
      unsubscribe();
    },
  };
}

/** Calls `now` when the browser comes back online or the page is shown again; returns the unsubscribe. */
export function retryWhenBack(now: () => void): () => void {
  const shown = () => {
    if (document.visibilityState === "visible") now();
  };
  window.addEventListener("online", now);
  document.addEventListener("visibilitychange", shown);
  return () => {
    window.removeEventListener("online", now);
    document.removeEventListener("visibilitychange", shown);
  };
}
