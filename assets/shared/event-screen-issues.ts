/**
 * What is wrong with a screen right now, from its live status, its last
 * hour of quality samples and the age of its latest screenshot. One pure
 * function, so the Screens tab, the studio and any later alert agree on the
 * same issues, labels and tiers. The thresholds live in one place.
 */
import { formatNumber } from "./format-number";
import { screenBrowserNeedsResume, screenStudioLinkLabel } from "./event-screen-health";
import { screenNetworkReadings } from "./event-screen-quality";
import type { ScreenLiveStatus, ScreenQualitySample } from "./schemas/event-screen-monitor";

/**
 * Each issue's two tiers: a warning at the early sign, critical when it
 * needs someone now. Comparisons are as named: "above" and "below" are
 * strict, "at least" includes the value.
 */
export const SCREEN_ISSUE_RULES = {
  /** Seconds since the screen's last heartbeat, above. */
  heartbeatSeconds: { warning: 30, critical: 120 },
  /** Internet loss averaged over the window, at least. */
  lossPercent: { warning: 2, critical: 10 },
  lossWindowMinutes: 5,
  /** Internet latency at least this in enough minutes of the window. */
  latencyMs: { warning: 150, critical: 300 },
  latencyMinutes: 3,
  latencyWindowMinutes: 5,
  /** The Wi-Fi signal as the device reports it from 0 to 100, below. */
  wifiSignalPercent: { warning: 50, critical: 30 },
  /** Livestream stalls in the window, at least; reconnecting or no stream is critical at once. */
  stalls: { warning: 1, critical: 3 },
  stallsWindowMinutes: 5,
  /** Minutes since the latest screenshot while online, above. */
  pictureMinutes: { warning: 2, critical: 5 },
} as const;

export const SCREEN_ISSUE_CODES = [
  "offline",
  "livestream",
  "loss",
  "latency",
  "weak-wifi",
  "no-recent-picture",
  "cached-agenda",
  "browser-resume",
  "browser-sharing",
  "browser-awake",
] as const;
export type ScreenIssueCode = (typeof SCREEN_ISSUE_CODES)[number];
export type ScreenIssueSeverity = "critical" | "warning";

export interface ScreenIssue {
  code: ScreenIssueCode;
  /** A word or two for a badge: "Loss 7 %", "Weak Wi-Fi". */
  label: string;
  /** One issue of a code at a time, in the tier it has reached. */
  severity: ScreenIssueSeverity;
  /** When it began, at either tier, as far as the monitor can tell. */
  since: string;
}

const MINUTE_MS = 60_000;

/** The samples of the last `minutes` minutes, the current one included. */
function window(samples: readonly ScreenQualitySample[], now: number, minutes: number) {
  const since = Math.floor(now / MINUTE_MS) * MINUTE_MS - (minutes - 1) * MINUTE_MS;
  return samples.filter((sample) => Date.parse(sample.minute) >= since);
}

/** The tier a reading has reached, given whether it passes each tier's threshold. */
function tier(passes: (threshold: "warning" | "critical") => boolean): ScreenIssueSeverity | null {
  return passes("critical") ? "critical" : passes("warning") ? "warning" : null;
}

const age = (instant: string, now: number) => now - Date.parse(instant);

export function screenIssues({
  status,
  samples,
  screenshotAt,
  now,
}: {
  status: ScreenLiveStatus | undefined;
  samples: readonly ScreenQualitySample[];
  /** When the monitor received its latest screenshot, if any. */
  screenshotAt: string | null;
  now: number;
}): ScreenIssue[] {
  if (!status) return [];
  const rules = SCREEN_ISSUE_RULES;
  const issues: ScreenIssue[] = [];
  const add = (code: ScreenIssueCode, label: string, severity: ScreenIssueSeverity | null, since: string) => {
    if (severity) issues.push({ code, label, severity, since });
  };

  const heardAt = status.reportedAt ?? (status.online ? status.connectedAt : status.disconnectedAt);
  if (heardAt) {
    const silence = tier((level) => age(heardAt, now) > rules.heartbeatSeconds[level] * 1000);
    // Connected but silent is "not responding"; only a closed connection is "offline".
    add("offline", status.online ? "Not responding" : "Offline", silence, heardAt);
  }
  // A disconnected screen's last readings say nothing about now.
  if (!status.online) return issues;

  const health = status.health;
  const stateSince = status.stateSince ?? status.reportedAt ?? status.connectedAt ?? new Date(now).toISOString();
  const stalled = window(samples, now, rules.stallsWindowMinutes).filter(
    (sample) => (sample.livestreamStalls ?? 0) > 0,
  );
  const stalls = stalled.reduce((sum, sample) => sum + sample.livestreamStalls!, 0);
  if (health?.display === "livestream") {
    const player = health.player;
    if (!player) add("livestream", "No stream", "critical", stateSince);
    else if (player.status === "error" || player.status === "buffering")
      add("livestream", "Reconnecting", "critical", player.changedAt);
    else
      add(
        "livestream",
        "Stalling",
        tier((level) => stalls >= rules.stalls[level]),
        stalled[0]?.minute ?? stateSince,
      );
  }

  const loss = window(samples, now, rules.lossWindowMinutes).filter((sample) => sample.internetLossPercent !== null);
  const lossAverage = loss.length
    ? loss.reduce((sum, sample) => sum + sample.internetLossPercent!, 0) / loss.length
    : 0;
  add(
    "loss",
    `Loss ${formatNumber(Math.round(lossAverage * 10) / 10)} %`,
    tier((level) => lossAverage >= rules.lossPercent[level]),
    loss.find((sample) => sample.internetLossPercent! > 0)?.minute ?? stateSince,
  );

  const latency = window(samples, now, rules.latencyWindowMinutes);
  const slowMinutes = (level: "warning" | "critical") =>
    latency.filter((sample) => (sample.internetLatencyMs ?? 0) >= rules.latencyMs[level]);
  add(
    "latency",
    "Slow internet",
    tier((level) => slowMinutes(level).length >= rules.latencyMinutes),
    slowMinutes("warning")[0]?.minute ?? stateSince,
  );

  const signal = screenNetworkReadings(health?.metrics).wifiSignalPercent;
  if (signal !== null) {
    // Since the run of weak minutes that leads up to now began.
    let since = stateSince;
    for (const sample of [...samples].reverse()) {
      if (sample.wifiSignalPercent === null || sample.wifiSignalPercent >= rules.wifiSignalPercent.warning) break;
      since = sample.minute;
    }
    add(
      "weak-wifi",
      "Weak Wi-Fi",
      tier((level) => signal < rules.wifiSignalPercent[level]),
      since,
    );
  }

  // Only a screen that has sent a screenshot is judged on its age: a device without the screenshot service never sends one.
  // A browser screen whose capture ended says so below instead.
  const browser = health?.kind === "browser" ? health.browser : null;
  if (screenshotAt && (!browser || browser.capture === "live"))
    add(
      "no-recent-picture",
      "No recent picture",
      tier((level) => age(screenshotAt, now) > rules.pictureMinutes[level] * MINUTE_MS),
      screenshotAt,
    );

  // What a reload or the person sharing took from a browser screen: never critical on its own.
  if (browser?.capture === "stopped") add("browser-sharing", "No picture (sharing stopped)", "warning", stateSince);
  else if (browser && screenBrowserNeedsResume(browser))
    add("browser-resume", "Needs a click to resume", "warning", stateSince);
  // The laptop may sleep or dim: the browser refused the wake lock, or has none.
  if (browser && !browser.wakeLock) add("browser-awake", "May sleep", "warning", stateSince);

  if (health?.mode === "auto" || health?.mode === "offline")
    add(
      "cached-agenda",
      // The same words as the screen's health badge, which then is not repeated.
      health.mode === "auto" ? "Running on the agenda" : screenStudioLinkLabel(health.studioRefusal),
      "warning",
      stateSince,
    );

  return issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

const severityRank = (severity: ScreenIssueSeverity | null) =>
  severity === "critical" ? 0 : severity === "warning" ? 1 : 2;

/** The worst severity among a screen's issues, or null when it has none. */
export function screenIssueSeverity(issues: readonly ScreenIssue[]): ScreenIssueSeverity | null {
  if (issues.some((issue) => issue.severity === "critical")) return "critical";
  return issues.length ? "warning" : null;
}

/** Screens with critical issues first, then warnings, then the rest, each group in its given order. */
export function sortByScreenIssues<T>(items: readonly T[], issuesOf: (item: T) => readonly ScreenIssue[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: severityRank(screenIssueSeverity(issuesOf(item))) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/** How many screens are at each tier, by their worst issue. */
export function screenIssueCounts(issueLists: Iterable<readonly ScreenIssue[]>): { critical: number; warning: number } {
  const counts = { critical: 0, warning: 0 };
  for (const issues of issueLists) {
    const severity = screenIssueSeverity(issues);
    if (severity) counts[severity] += 1;
  }
  return counts;
}
