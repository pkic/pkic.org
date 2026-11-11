/**
 * What a screen actually draws, from its live report, and the device
 * metrics worth a glance.
 */
import {
  SCREEN_CLOCK_DRIFT_WARNING_MS,
  screenHealthDisplay,
  screenKeyMetrics,
} from "../../../../../../../shared/event-screen-health";
import type { ScreenLiveStatus } from "../../../../../../../shared/schemas/event-screen-monitor";
import { Badge } from "../../../../../../ui/Badge";

/** The metrics line: uptime, temperature and, when it drifts, the clock. */
export function screenHealthDetail(status: ScreenLiveStatus): string {
  const parts = screenKeyMetrics(status);
  const offset = status.health?.clockOffsetMs ?? 0;
  if (Math.abs(offset) >= SCREEN_CLOCK_DRIFT_WARNING_MS)
    parts.push(`Clock ${offset > 0 ? "behind" : "ahead"} ${(Math.abs(offset) / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

/**
 * Beneath a screen's assignment: a fault or fallback in tone (a screen doing
 * what it was assigned adds nothing), then the device metrics.
 */
export function ScreenHealthCell({ status }: { status: ScreenLiveStatus | undefined }) {
  if (!status?.health || !status.online) return null;
  const { label, tone } = screenHealthDisplay(status.health);
  const detail = screenHealthDetail(status);
  return (
    <>
      {tone && (
        <span>
          <Badge tone={tone}>{label}</Badge>
        </span>
      )}
      {detail && <span class="pk-muted pk-small">{detail}</span>}
    </>
  );
}
