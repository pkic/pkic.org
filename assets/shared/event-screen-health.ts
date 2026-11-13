import { formatDuration } from "./format-date";
import { formatNumber } from "./format-number";
import {
  SCREEN_PAGE_OUTDATED,
  type ScreenBrowserState,
  type ScreenHealth,
  type ScreenLiveStatus,
  type ScreenMetricValue,
} from "./schemas/event-screen-monitor";

/**
 * How a screen's live health reads to staff: the state of what it draws, or
 * its fault. Staff see the room and output beside it, so the label never
 * repeats them. Expected states carry no tone; only a fault or a fallback does.
 */
export function screenHealthDisplay(health: ScreenHealth): {
  label: string;
  tone: "risk" | "warn" | "info" | null;
} {
  if (health.display === "pairing") return { label: "Showing a pairing code", tone: "warn" };
  if (health.display === "waiting") return { label: "Not assigned", tone: null };
  if (health.player) {
    if (health.player.status === "error" || health.player.status === "buffering")
      return { label: "Reconnecting", tone: "risk" };
    if (health.player.status === "loading") return { label: "Starting", tone: null };
    if (health.player.muted) return { label: "Muted", tone: "warn" };
    return { label: "Playing", tone: null };
  }
  if (health.display === "livestream") return { label: "No stream", tone: "warn" };
  if (health.mode === "auto") return { label: "Running on the agenda", tone: "info" };
  if (health.mode === "offline") return { label: screenStudioLinkLabel(health.studioLinkReason), tone: "warn" };
  if (health.display === "idle") return { label: "Waiting for the studio", tone: null };
  return { label: "Following the studio", tone: null };
}

const STUDIO_LINK_REASONS: Readonly<Record<string, string>> = {
  [SCREEN_PAGE_OUTDATED]: "page outdated",
  LIVE_OVERLAY_ACCESS_INVALID: "access refused",
  LIVE_ROOM_ACCESS_EXPIRED: "access refused",
  LIVE_PROGRAM_SELECTION_CHANGED: "session switched",
  LIVE_PROGRAM_ROOM_NOT_FOUND: "room not on the agenda",
  LIVE_SESSION_NOT_FOUND: "no live room",
  EVENT_NOT_FOUND: "event removed",
  LIVE_ROOMS_UNAVAILABLE: "live rooms unavailable",
};

/** "4 min", "12 h": how long, coarse; nothing under a minute. */
function downFor(milliseconds: number): string | null {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return null;
  return minutes < 60 ? `${formatNumber(minutes)} min` : `${formatNumber(Math.floor(minutes / 60))} h`;
}

/**
 * A screen whose link to the studio is down: it keeps drawing the last state
 * it had, its clocks still running, so its screenshots still change. The
 * label names the link, how long it has been down when known, and why.
 */
export function screenStudioLinkLabel(reason: string | null, downForMs: number | null = null): string {
  const span = downForMs === null ? null : downFor(downForMs);
  const why = reason ? ` (${STUDIO_LINK_REASONS[reason] ?? reason})` : "";
  return `Studio link down${span ? ` for ${span}` : ""}${why}`;
}

const STUDIO_LINK_NEXT: Readonly<Record<string, string>> = {
  LIVE_OVERLAY_ACCESS_INVALID:
    "The room refused its access: it asks for new access by itself. If this lasts, use Reload.",
  LIVE_ROOM_ACCESS_EXPIRED: "The room refused its access: it asks for new access by itself. If this lasts, use Reload.",
  LIVE_PROGRAM_SELECTION_CHANGED: "The studio switched sessions: it follows the new one by itself.",
};

/**
 * What still works and what does not while a screen runs on its own, for the
 * staff who see its screenshots still change: they come over the monitor
 * connection, not from the studio. Null while it follows the studio.
 */
export function screenOwnRunHint(health: ScreenHealth): { works: string; stopped: string; next: string } | null {
  if (health.mode === "auto")
    return {
      works: "Online, screenshots and its own copy of the agenda, with the coming sessions and their countdowns.",
      stopped: "The studio: its session ended and the link is down, so nothing the studio changes reaches the screen.",
      next: "It follows the studio again once the link is back.",
    };
  if (health.mode !== "offline") return null;
  return {
    works: "Online, screenshots and its clocks: it keeps showing the last state the studio sent.",
    stopped: "Updates from the studio: timers, messages and stage changes do not reach the screen.",
    next:
      health.studioLinkReason === SCREEN_PAGE_OUTDATED
        ? // A device loads the new page by itself; a browser screen keeps its tab, which a reload would stop sharing.
          health.kind === "browser"
          ? "Its page is older than the server's: reload its browser tab, then share the screen again."
          : "Its page is older than the server's: it loads the new one by itself within a minute."
        : ((health.studioLinkReason && STUDIO_LINK_NEXT[health.studioLinkReason]) ??
          "If this lasts, check its network or use Reload."),
  };
}

/** What a screen draws, as one comparable value: a change starts its `stateSince` over. */
export function screenHealthState(health: ScreenHealth): string {
  const browser = health.browser;
  return [
    health.display,
    health.mode,
    health.output ?? "",
    health.player?.status ?? "",
    health.player?.muted ?? "",
    browser ? `${browser.fullscreen}:${browser.wakeLock}:${browser.sound}:${browser.capture}` : "",
  ].join("|");
}

function highest(value: ScreenMetricValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (value === null || typeof value !== "object") return null;
  const found = (Array.isArray(value) ? value : Object.values(value))
    .map(highest)
    .filter((each): each is number => each !== null);
  return found.length ? Math.max(...found) : null;
}

/** The device metrics shown at a glance: how long it has run and its hottest sensor. */
export function screenKeyMetrics(status: Pick<ScreenLiveStatus, "health">): string[] {
  const metrics = status.health?.metrics;
  if (!metrics) return [];
  const shown: string[] = [];
  if (typeof metrics.uptime === "number" && metrics.uptime >= 0)
    shown.push(`Up ${formatDuration(metrics.uptime * 1000)}`);
  const temperature = highest(metrics.temps);
  if (temperature !== null) shown.push(`${formatNumber(Math.round(temperature))} °C`);
  return shown;
}

/** A clock this far off the server's shows its countdowns visibly wrong. */
export const SCREEN_CLOCK_DRIFT_WARNING_MS = 2_000;

/** What a click on a browser screen would bring back: full screen, blocked sound or the tab capture. */
export function screenBrowserNeedsResume(state: ScreenBrowserState): boolean {
  return !state.fullscreen || state.sound === "blocked" || state.capture !== "live";
}
