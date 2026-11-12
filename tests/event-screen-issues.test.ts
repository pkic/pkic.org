import { describe, expect, it } from "vitest";
import {
  SCREEN_ISSUE_RULES as RULES,
  screenIssueCounts,
  screenIssueSeverity,
  screenIssues,
  sortByScreenIssues,
  type ScreenIssue,
} from "../assets/shared/event-screen-issues";
import type {
  ScreenHealth,
  ScreenLiveStatus,
  ScreenQualitySample,
} from "../assets/shared/schemas/event-screen-monitor";

const NOW = Date.parse("2026-11-11T10:30:20.000Z");
const ms = (milliseconds: number) => new Date(NOW - milliseconds).toISOString();
const ago = (minutes: number) => ms(minutes * 60_000);
const minute = (minutesAgo: number) => new Date(Math.floor(NOW / 60_000) * 60_000 - minutesAgo * 60_000).toISOString();

const HEALTH: ScreenHealth = {
  pageVersion: "p",
  kind: "device",
  browser: null,
  display: "output",
  output: "projector",
  mode: "live",
  player: null,
  clockOffsetMs: 0,
  metrics: { network: { wifi: { signal: 70 } } },
};
const online = (health: Partial<ScreenHealth> = {}, status: Partial<ScreenLiveStatus> = {}): ScreenLiveStatus => ({
  screenId: "K7M2QA",
  online: true,
  connectedAt: ago(60),
  disconnectedAt: null,
  reportedAt: ms(5_000),
  stateSince: ago(20),
  health: { ...HEALTH, ...health },
  ...status,
});
const sample = (minutesAgo: number, overrides: Partial<ScreenQualitySample>): ScreenQualitySample => ({
  minute: minute(minutesAgo),
  internetLatencyMs: 20,
  internetLossPercent: 0,
  routerLatencyMs: 2,
  wifiSignalPercent: 70,
  rxBitsPerSecond: null,
  livestreamStalls: null,
  ...overrides,
});
const issues = (status: ScreenLiveStatus | undefined, samples: ScreenQualitySample[] = [], screenshotAt = ms(10_000)) =>
  screenIssues({ status, samples, screenshotAt, now: NOW });
/** The one issue of this code, as [label, tier], or null. */
function tierOf(found: ScreenIssue[], code: ScreenIssue["code"]) {
  const issue = found.find((each) => each.code === code);
  return issue ? [issue.label, issue.severity] : null;
}

describe("a screen's issues", () => {
  it("has none while it is healthy, or unknown to the monitor", () => {
    expect(issues(online(), [sample(0, {}), sample(1, {})])).toEqual([]);
    expect(issues(undefined)).toEqual([]);
  });

  it("warns after the heartbeat is late and goes critical once it is long gone", () => {
    const late = (milliseconds: number) => tierOf(issues(online({}, { reportedAt: ms(milliseconds) })), "offline");
    expect(late(RULES.heartbeatSeconds.warning * 1000)).toBeNull();
    expect(late(RULES.heartbeatSeconds.warning * 1000 + 1)).toEqual(["Not responding", "warning"]);
    expect(late(RULES.heartbeatSeconds.critical * 1000)).toEqual(["Not responding", "warning"]);
    expect(late(RULES.heartbeatSeconds.critical * 1000 + 1)).toEqual(["Not responding", "critical"]);

    const disconnected = (milliseconds: number) =>
      issues(online({}, { online: false, disconnectedAt: ms(milliseconds), reportedAt: ms(milliseconds) }), [
        sample(0, { internetLossPercent: 50 }),
      ]);
    expect(disconnected(10_000)).toEqual([]);
    expect(disconnected(RULES.heartbeatSeconds.critical * 1000 + 1)).toEqual([
      {
        code: "offline",
        label: "Offline",
        severity: "critical",
        since: ms(RULES.heartbeatSeconds.critical * 1000 + 1),
      },
    ]);
    expect(disconnected(RULES.heartbeatSeconds.warning * 1000 + 1)[0]).toMatchObject({ severity: "warning" });
  });

  it("tiers internet loss by its average over the window", () => {
    const loss = (percent: number, minutesAgo = 0) =>
      tierOf(issues(online(), [sample(minutesAgo, { internetLossPercent: percent })]), "loss");
    expect(loss(RULES.lossPercent.warning - 0.6)).toBeNull();
    expect(loss(RULES.lossPercent.warning)).toEqual(["Loss 2 %", "warning"]);
    expect(loss(RULES.lossPercent.critical - 0.1)).toEqual(["Loss 9.9 %", "warning"]);
    expect(loss(RULES.lossPercent.critical)).toEqual(["Loss 10 %", "critical"]);
    expect(loss(50, RULES.lossWindowMinutes)).toBeNull();
    const averaged = issues(online(), [sample(3, { internetLossPercent: 12 }), sample(1, { internetLossPercent: 0 })]);
    expect(averaged.find((issue) => issue.code === "loss")).toMatchObject({ label: "Loss 6 %", since: minute(3) });
  });

  it("tiers latency by how many minutes of the window reach each threshold", () => {
    const slow = (...latencies: number[]) =>
      tierOf(
        issues(
          online(),
          latencies.map((latency, index) => sample(index, { internetLatencyMs: latency })),
        ),
        "latency",
      );
    const { warning, critical } = RULES.latencyMs;
    expect(slow(warning, warning, warning - 1)).toBeNull();
    expect(slow(warning, warning, warning)).toEqual(["Slow internet", "warning"]);
    expect(slow(critical, critical, warning)).toEqual(["Slow internet", "warning"]);
    expect(slow(critical, critical, critical)).toEqual(["Slow internet", "critical"]);
    expect(RULES.latencyMinutes).toBe(3);
  });

  it("tiers the Wi-Fi signal, since the weak run began", () => {
    const wifi = (signal: number) =>
      tierOf(issues(online({ metrics: { network: { wifi: { signal } } } })), "weak-wifi");
    expect(wifi(RULES.wifiSignalPercent.warning)).toBeNull();
    expect(wifi(RULES.wifiSignalPercent.warning - 1)).toEqual(["Weak Wi-Fi", "warning"]);
    expect(wifi(RULES.wifiSignalPercent.critical)).toEqual(["Weak Wi-Fi", "warning"]);
    expect(wifi(RULES.wifiSignalPercent.critical - 1)).toEqual(["Weak Wi-Fi", "critical"]);
    const run = issues(online({ metrics: { network: { wifi: { signal: 20 } } } }), [
      sample(4, { wifiSignalPercent: 60 }),
      sample(3, { wifiSignalPercent: 45 }),
      sample(1, { wifiSignalPercent: 25 }),
    ]);
    expect(run.find((issue) => issue.code === "weak-wifi")?.since).toBe(minute(3));
  });

  it("tiers a livestream by its stalls, and is critical at once when it is down", () => {
    const livestream = (player: ScreenHealth["player"]) =>
      online({ display: "livestream", output: "livestream", player });
    const playing = livestream({ status: "playing", muted: false, changedAt: ago(30), playback: null });
    const stalls = (count: number, minutesAgo = 1) =>
      tierOf(issues(playing, count ? [sample(minutesAgo, { livestreamStalls: count })] : []), "livestream");
    expect(stalls(0)).toBeNull();
    expect(stalls(RULES.stalls.warning)).toEqual(["Stalling", "warning"]);
    expect(stalls(RULES.stalls.critical - 1)).toEqual(["Stalling", "warning"]);
    expect(stalls(RULES.stalls.critical)).toEqual(["Stalling", "critical"]);
    expect(stalls(9, RULES.stallsWindowMinutes)).toBeNull();
    const reconnecting = livestream({ status: "error", muted: false, changedAt: ago(1), playback: null });
    expect(issues(reconnecting)).toEqual([
      { code: "livestream", label: "Reconnecting", severity: "critical", since: ago(1) },
    ]);
    expect(issues(livestream(null))).toEqual([
      { code: "livestream", label: "No stream", severity: "critical", since: ago(20) },
    ]);
  });

  it("tiers the age of the latest screenshot, and says nothing until one has arrived", () => {
    const picture = (milliseconds: number) => tierOf(issues(online(), [], ms(milliseconds)), "no-recent-picture");
    expect(picture(RULES.pictureMinutes.warning * 60_000)).toBeNull();
    expect(picture(RULES.pictureMinutes.warning * 60_000 + 1)).toEqual(["No recent picture", "warning"]);
    expect(picture(RULES.pictureMinutes.critical * 60_000)).toEqual(["No recent picture", "warning"]);
    expect(picture(RULES.pictureMinutes.critical * 60_000 + 1)).toEqual(["No recent picture", "critical"]);
    // A device without the screenshot service never sends one: no picture is not an issue.
    expect(screenIssues({ status: online(), samples: [], screenshotAt: null, now: NOW })).toEqual([]);
  });

  it("warns while the screen runs on its cached agenda, in its health badge's words", () => {
    expect(issues(online({ mode: "auto" }))).toEqual([
      { code: "cached-agenda", label: "Running on the agenda", severity: "warning", since: ago(20) },
    ]);
    expect(tierOf(issues(online({ mode: "offline" })), "cached-agenda")).toEqual(["Holding last picture", "warning"]);
  });

  it("lists critical issues first, sorts screens by their worst and counts them by tier", () => {
    const mixed = issues(online({ mode: "auto", metrics: { network: { wifi: { signal: 10 } } } }));
    expect(mixed.map((issue) => issue.severity)).toEqual(["critical", "warning"]);
    const warning = issues(online({ mode: "auto" }));
    expect(screenIssueSeverity(mixed)).toBe("critical");
    expect(screenIssueSeverity([])).toBeNull();
    const sorted = sortByScreenIssues(
      [
        { id: "a", issues: [] },
        { id: "b", issues: warning },
        { id: "c", issues: [] },
        { id: "d", issues: mixed },
      ],
      (item) => item.issues,
    );
    expect(sorted.map((item) => item.id)).toEqual(["d", "b", "a", "c"]);
    expect(screenIssueCounts([mixed, warning, warning, []])).toEqual({ critical: 1, warning: 2 });
  });

  it("warns a browser screen that needs a click or stopped sharing, never critical, and ignores its missing network", () => {
    const browser = (state: Partial<NonNullable<ScreenHealth["browser"]>>) =>
      online({
        kind: "browser",
        metrics: null,
        browser: { fullscreen: true, wakeLock: true, sound: "on", capture: "live", ...state },
      });
    expect(issues(browser({}))).toEqual([]);
    // A player still starting, or none at all, is not missing sound.
    expect(issues(browser({ sound: "starting" }))).toEqual([]);
    expect(issues(browser({ sound: "none" }))).toEqual([]);
    expect(issues(browser({ sound: "blocked" })).map((issue) => issue.code)).toEqual(["browser-resume"]);
    expect(issues(browser({ fullscreen: false, sound: "blocked", capture: "off" }))).toEqual([
      { code: "browser-resume", label: "Needs a click to resume", severity: "warning", since: ago(20) },
    ]);
    // Sharing stopped: its last screenshot ages without counting against it.
    const stopped = screenIssues({
      status: browser({ capture: "stopped" }),
      samples: [],
      screenshotAt: ago(RULES.pictureMinutes.critical + 5),
      now: NOW,
    });
    expect(stopped).toEqual([
      { code: "browser-sharing", label: "No picture (sharing stopped)", severity: "warning", since: ago(20) },
    ]);
  });
});
