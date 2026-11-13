import {
  screenMonitorServerMessageSchema,
  type ScreenLiveStatus,
} from "../../../assets/shared/schemas/event-screen-monitor";

/** Shared fixtures for the staff side of the screen monitor tests. */
export const SLUG = "pqc-conference-2026";
export const NOW = Date.parse("2026-12-01T09:27:20.000Z");
export const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

export const status = (screenId: string, overrides: Partial<ScreenLiveStatus> = {}): ScreenLiveStatus => ({
  screenId,
  online: true,
  connectedAt: at(3600),
  disconnectedAt: null,
  reportedAt: at(5),
  stateSince: at(600),
  health: {
    pageVersion: "p",
    kind: "device",
    browser: null,
    display: "output",
    output: "projector",
    mode: "live",
    studioRefusal: null,
    player: null,
    clockOffsetMs: 0,
    metrics: null,
  },
  ...overrides,
});
export const message = (value: unknown) => screenMonitorServerMessageSchema.parse(value);
