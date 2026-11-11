import { formatDuration } from "./format-date";
import { formatNumber } from "./format-number";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "./live-room-outputs";
import type { ScreenHealth, ScreenLiveStatus, ScreenMetricValue } from "./schemas/event-screen-monitor";

/**
 * How a screen's live health reads to staff: what it actually draws and any
 * fault, and the few device metrics worth a glance. Expected states carry no
 * tone; only a fault or a fallback does.
 */
export function screenHealthDisplay(health: ScreenHealth): {
  label: string;
  tone: "risk" | "warn" | "info" | null;
} {
  if (health.display === "pairing") return { label: "Showing a pairing code", tone: "warn" };
  if (health.display === "waiting") return { label: "Not assigned", tone: null };
  if (health.player) {
    if (health.player.status === "error" || health.player.status === "buffering")
      return { label: "Livestream · Reconnecting", tone: "risk" };
    if (health.player.status === "loading") return { label: "Livestream · Starting", tone: null };
    if (health.player.muted) return { label: "Livestream · Muted", tone: "warn" };
    return { label: "Livestream · Playing", tone: null };
  }
  if (health.display === "livestream") return { label: "Livestream · No stream", tone: "warn" };
  const output = health.output ? LIVE_SCREEN_OUTPUT_DETAILS[health.output].label : "Output";
  if (health.mode === "auto") return { label: `${output} · Running on the agenda`, tone: "info" };
  if (health.mode === "offline") return { label: `${output} · Holding last picture`, tone: "warn" };
  if (health.display === "idle") return { label: `${output} · Waiting for the studio`, tone: null };
  return { label: output, tone: null };
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
