import { formatDuration } from "./format-date";
import { formatNumber } from "./format-number";
import type {
  ScreenBrowserState,
  ScreenHealth,
  ScreenLiveStatus,
  ScreenMetricValue,
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
  if (health.mode === "offline") return { label: screenStudioLinkLabel(health.studioRefusal), tone: "warn" };
  if (health.display === "idle") return { label: "Waiting for the studio", tone: null };
  return { label: "Following the studio", tone: null };
}

const STUDIO_REFUSALS: Readonly<Record<string, string>> = {
  LIVE_OVERLAY_ACCESS_INVALID: "access refused",
  LIVE_ROOM_ACCESS_EXPIRED: "access refused",
  LIVE_PROGRAM_SELECTION_CHANGED: "session switched",
  LIVE_PROGRAM_ROOM_NOT_FOUND: "room not on the agenda",
  LIVE_SESSION_NOT_FOUND: "no live room",
  EVENT_NOT_FOUND: "event removed",
  LIVE_ROOMS_UNAVAILABLE: "live rooms unavailable",
};

/**
 * A screen whose link to the studio is down: it keeps drawing the last state
 * it had, its timers still counting, so its picture still changes. The label
 * names the link and, when the room turned the screen away, why.
 */
export function screenStudioLinkLabel(refusal: string | null): string {
  if (!refusal) return "Studio link down";
  return `Studio link down (${STUDIO_REFUSALS[refusal] ?? refusal})`;
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
