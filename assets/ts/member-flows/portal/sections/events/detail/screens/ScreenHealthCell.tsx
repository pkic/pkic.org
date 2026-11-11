/**
 * The device metrics worth a glance, from a screen's live report.
 */
import { SCREEN_CLOCK_DRIFT_WARNING_MS, screenKeyMetrics } from "../../../../../../../shared/event-screen-health";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { ScreenLiveStatus } from "../../../../../../../shared/schemas/event-screen-monitor";

/** The metrics line: uptime, temperature and, when it drifts, the clock. */
export function screenHealthDetail(status: ScreenLiveStatus): string {
  const parts = screenKeyMetrics(status);
  const offset = status.health?.clockOffsetMs ?? 0;
  if (Math.abs(offset) >= SCREEN_CLOCK_DRIFT_WARNING_MS)
    parts.push(`Clock ${offset > 0 ? "behind" : "ahead"} ${formatNumber(Math.round(Math.abs(offset) / 100) / 10)} s`);
  return parts.join(" · ");
}

/** Beneath a screen's assignment: the device metrics worth a glance, while it is online. */
export function ScreenHealthCell({ status }: { status: ScreenLiveStatus | undefined }) {
  if (!status?.health || !status.online) return null;
  const detail = screenHealthDetail(status);
  return detail ? <span class="pk-muted pk-small">{detail}</span> : null;
}
