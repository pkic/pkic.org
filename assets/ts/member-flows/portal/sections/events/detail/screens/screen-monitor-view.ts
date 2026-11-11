/**
 * What staff hold of the event's screen monitor: each screen's live status,
 * its last hour of quality samples and its latest screenshot, by screen ID.
 * The monitor connection builds it; the Screens tab and the studio's Screens
 * panel draw it.
 */
import { screenIssues, type ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import { withScreenQualitySample } from "../../../../../../../shared/event-screen-quality";
import type {
  ScreenLiveStatus,
  ScreenMonitorServerMessage,
  ScreenQualitySample,
} from "../../../../../../../shared/schemas/event-screen-monitor";

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

export const EMPTY_SCREEN_MONITOR_VIEW: ScreenMonitorView = {
  live: new Map(),
  quality: new Map(),
  screenshots: new Map(),
};

/** The view after one message from the monitor; acknowledgments and refusals leave it as it is. */
export function applyScreenMonitorMessage(
  view: ScreenMonitorView,
  message: ScreenMonitorServerMessage,
): ScreenMonitorView {
  switch (message.type) {
    case "screens.snapshot": {
      const live = new Map(message.screens.map((status) => [status.screenId, status]));
      // The snapshot's screenshots follow it; one of a screen it no longer knows is dropped.
      return {
        live,
        quality: new Map(message.quality.map((history) => [history.screenId, history.samples])),
        screenshots: new Map([...view.screenshots].filter(([screenId]) => live.has(screenId))),
      };
    }
    case "screens.changed": {
      const live = new Map(view.live).set(message.screen.screenId, message.screen);
      if (!message.sample) return { ...view, live };
      const samples = withScreenQualitySample(view.quality.get(message.screen.screenId) ?? [], message.sample);
      return { ...view, live, quality: new Map(view.quality).set(message.screen.screenId, samples) };
    }
    case "screens.screenshot":
      return {
        ...view,
        screenshots: new Map(view.screenshots).set(message.screenId, {
          capturedAt: message.capturedAt,
          src: screenshotSource(message.jpeg),
        }),
      };
    default:
      return view;
  }
}

/** Each screen's issues now, by screen ID, for every screen the monitor knows. */
export function screenMonitorIssues(view: ScreenMonitorView, now: number): Map<string, ScreenIssue[]> {
  return new Map(
    [...view.live.values()].map((status) => [
      status.screenId,
      screenIssues({
        status,
        samples: view.quality.get(status.screenId) ?? [],
        screenshotAt: view.screenshots.get(status.screenId)?.capturedAt ?? null,
        now,
      }),
    ]),
  );
}
