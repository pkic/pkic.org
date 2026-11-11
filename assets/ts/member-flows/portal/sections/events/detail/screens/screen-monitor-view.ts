/**
 * What staff hold of the event's screen monitor: each screen's live status,
 * its last hour of quality samples and its latest screenshot, by screen ID.
 * The monitor connection builds it; the Screens tab and the studio's Screens
 * panel draw it.
 */
import type { ScreenLiveStatus, ScreenQualitySample } from "../../../../../../../shared/schemas/event-screen-monitor";

export interface ScreenMonitorScreenshot {
  /** When the monitor received it. */
  capturedAt: string;
  /** The JPEG as an image address the page can show. */
  src: string;
}

export interface ScreenMonitorView {
  live: ReadonlyMap<string, ScreenLiveStatus>;
  quality: ReadonlyMap<string, readonly ScreenQualitySample[]>;
  screenshots: ReadonlyMap<string, ScreenMonitorScreenshot>;
}

export function screenshotSource(jpeg: string): string {
  return `data:image/jpeg;base64,${jpeg}`;
}
