/**
 * Synthetic monitor data for the screen monitoring specimens: live reports,
 * an hour of quality samples and drawn stand-ins for screenshots, all on the
 * gallery's fixed clock.
 */
import type { ScreenHealth, ScreenLiveStatus, ScreenQualitySample } from "../../../shared/schemas/event-screen-monitor";
import type { ScreenMonitorView } from "../../member-flows/portal/sections/events/detail/screens/screen-monitor-view";
import { SCREEN_FIXTURE, SCREEN_FIXTURE_NOW } from "./event-screens-fixtures";

const at = (minutesAgo: number) => new Date(SCREEN_FIXTURE_NOW - minutesAgo * 60_000).toISOString();

export const health = (overrides: Partial<ScreenHealth>): ScreenHealth => ({
  pageVersion: "screen-page-3f9a1c.js",
  display: "output",
  output: "projector",
  mode: "live",
  player: null,
  clockOffsetMs: 120,
  metrics: { uptime: 3 * 3600 + 12 * 60, temps: { cpu: 54.2, nvme: 41 } },
  ...overrides,
});

const status = (screenId: string, report: ScreenHealth, online = true): ScreenLiveStatus => ({
  screenId,
  online,
  connectedAt: at(190),
  disconnectedAt: online ? null : at(12),
  reportedAt: at(online ? 0.2 : 12),
  health: report,
});

/** A screenshot stand-in: a drawn frame of what the output shows, as an image address. */
function picture(kind: "livestream" | "slide" | "timer", title: string): string {
  const body =
    kind === "timer"
      ? `<rect width="480" height="270" fill="#111"/><text x="240" y="150" fill="#f5f5f5" font-size="88" font-family="sans-serif" text-anchor="middle">12:34</text><text x="240" y="200" fill="#9a9a9a" font-size="18" font-family="sans-serif" text-anchor="middle">${title}</text>`
      : kind === "slide"
        ? `<rect width="480" height="270" fill="#f4f6fa"/><rect y="0" width="480" height="36" fill="#1d3b72"/><text x="24" y="100" fill="#1d3b72" font-size="26" font-family="sans-serif" font-weight="700">${title}</text><rect x="24" y="128" width="300" height="10" rx="5" fill="#c6cfdf"/><rect x="24" y="150" width="260" height="10" rx="5" fill="#c6cfdf"/><rect x="24" y="172" width="280" height="10" rx="5" fill="#c6cfdf"/><circle cx="400" cy="170" r="44" fill="#5c8de0"/>`
        : `<rect width="480" height="270" fill="#25303d"/><rect x="0" y="170" width="480" height="100" fill="#3a4757"/><circle cx="170" cy="130" r="34" fill="#c99b7a"/><rect x="130" y="166" width="80" height="104" rx="18" fill="#4f6c8f"/><rect x="290" y="96" width="150" height="90" rx="6" fill="#1d3b72"/><rect x="206" y="214" width="250" height="36" rx="4" fill="#ffffff"/><text x="218" y="238" fill="#1d3b72" font-size="16" font-family="sans-serif">${title}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** An hour of samples with a gentle wobble, and trouble where `rough` says. */
function hour(base: { latency: number; signal: number; rx: number | null }, rough: readonly number[] = []) {
  const last = Math.floor(SCREEN_FIXTURE_NOW / 60_000) * 60_000;
  return Array.from({ length: 60 }, (_, index): ScreenQualitySample => {
    const minute = last - (59 - index) * 60_000;
    const wobble = Math.sin(index / 3) * 0.25 + Math.cos(index / 7) * 0.15;
    const trouble = rough.includes(index);
    return {
      minute: new Date(minute).toISOString(),
      internetLatencyMs: Math.round(base.latency * (1 + wobble) * (trouble ? 3.2 : 1)),
      internetLossPercent: trouble ? 3.3 : index % 17 === 5 ? 1.7 : 0,
      routerLatencyMs: Math.round(2 + wobble * 2),
      wifiSignalPercent: Math.round(base.signal - (trouble ? 18 : 0) + wobble * 4),
      rxBitsPerSecond: base.rx === null ? null : Math.round(base.rx * (1 + wobble / 3) * (trouble ? 0.4 : 1)),
      livestreamStalls: base.rx === null ? null : trouble ? 2 : 0,
    };
  });
}

export const MONITOR_SCREENS = {
  livestream: SCREEN_FIXTURE.screenId,
  stage: "Q4ZT7B",
  projector: "B5LN3D",
  greenRoom: "M3XW5C",
} as const;

export const MONITOR: ScreenMonitorView = {
  live: new Map(
    [
      status(
        MONITOR_SCREENS.livestream,
        health({
          display: "livestream",
          output: "livestream",
          player: { status: "playing", muted: true, changedAt: at(40), playback: null },
        }),
      ),
      status(MONITOR_SCREENS.stage, health({ output: "stage-display", mode: "auto", clockOffsetMs: 2400 })),
      status(MONITOR_SCREENS.projector, health({ output: "projector" })),
      status(MONITOR_SCREENS.greenRoom, health({ output: "projector" }), false),
    ].map((each) => [each.screenId, each]),
  ),
  quality: new Map([
    [MONITOR_SCREENS.livestream, hour({ latency: 18, signal: 68, rx: 5_200_000 }, [41, 42, 43])],
    [MONITOR_SCREENS.stage, hour({ latency: 14, signal: 80, rx: null })],
    [MONITOR_SCREENS.projector, hour({ latency: 22, signal: 61, rx: null }, [12])],
    [MONITOR_SCREENS.greenRoom, hour({ latency: 30, signal: 44, rx: null }).slice(0, 47)],
  ]),
  screenshots: new Map([
    [MONITOR_SCREENS.livestream, { capturedAt: at(0.2), src: picture("livestream", "Dr. Ada Example, Example Labs") }],
    [MONITOR_SCREENS.stage, { capturedAt: at(0.15), src: picture("timer", "Migrating a private CA") }],
    [MONITOR_SCREENS.projector, { capturedAt: at(0.1), src: picture("slide", "Hybrid certificates") }],
    [MONITOR_SCREENS.greenRoom, { capturedAt: at(12), src: picture("slide", "Welcome back") }],
  ]),
};
