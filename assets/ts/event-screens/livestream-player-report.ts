/**
 * The livestream player's state as the screen last reported it, for anything
 * on the page that forwards the screen's health. The player publishes; a
 * reader takes the latest report or subscribes to changes.
 */
import type { LivestreamPlayerStatus } from "./livestream-health";

export interface LivestreamPlayerReport {
  status: LivestreamPlayerStatus;
  videoId: string;
  /** Playing without sound: the browser refused to start it with sound. */
  muted: boolean;
  /** When the status or the video last changed, as an ISO-8601 UTC instant. */
  changedAt: string;
}

let latest: LivestreamPlayerReport | null = null;
const listeners = new Set<(report: LivestreamPlayerReport | null) => void>();

export function livestreamPlayerReport(): LivestreamPlayerReport | null {
  return latest;
}

export function subscribeLivestreamPlayerReport(listener: (report: LivestreamPlayerReport | null) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Null once no player runs. Reports that change nothing are not repeated. */
export function publishLivestreamPlayerReport(report: LivestreamPlayerReport | null): void {
  if (
    report === latest ||
    (report &&
      latest &&
      report.status === latest.status &&
      report.videoId === latest.videoId &&
      report.changedAt === latest.changedAt)
  )
    return;
  latest = report;
  for (const listener of listeners) listener(report);
}
