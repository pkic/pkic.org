/**
 * What a screen's device runs, from the metrics its page forwards: the build
 * its software came from and how its updates went. Staff see it on request,
 * in the screen's status tooltip; nothing here raises an issue.
 */
import { formatDate } from "./format-date";
import type { ScreenHealth, ScreenLiveStatus, ScreenMetricValue } from "./schemas/event-screen-monitor";

export interface ScreenSoftwareBuild {
  /** The short commit the image was built from; "-modified" when built with local changes. */
  commit: string;
  /** That commit's date, as an ISO-8601 UTC instant. */
  date: string;
}

function field(value: ScreenMetricValue | undefined, key: string): ScreenMetricValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined;
}

/** The build the screen's software came from, when its device says. */
export function screenSoftwareBuild(health: ScreenHealth | null | undefined): ScreenSoftwareBuild | null {
  const agent = field(health?.metrics?.versions, "agent");
  const commit = field(agent, "commit");
  const date = field(agent, "date");
  if (typeof commit !== "string" || typeof date !== "string" || Number.isNaN(Date.parse(date))) return null;
  return { commit, date };
}

/** The newest build among the event's screens, as the date of its commit; null when none says. */
export function newestScreenSoftware(statuses: Iterable<ScreenLiveStatus>): string | null {
  let newest: string | null = null;
  for (const status of statuses) {
    const build = screenSoftwareBuild(status.health);
    if (build && (newest === null || Date.parse(build.date) > Date.parse(newest))) newest = build.date;
  }
  return newest;
}

/**
 * "50a7960, Nov 12, 2026": the build, and whether it is older than the
 * newest the event's other screens run. Without a published release to
 * compare with, the other screens are the reference.
 */
export function screenSoftwareDetail(
  build: ScreenSoftwareBuild,
  newest: string | null,
): { text: string; older: boolean } {
  const text = `${build.commit}, ${formatDate(build.date)}`;
  const older = newest !== null && Date.parse(build.date) < Date.parse(newest);
  return older ? { text: `${text} · older than other screens (${formatDate(newest)})`, older } : { text, older };
}

function dateOf(seconds: ScreenMetricValue | undefined): string | null {
  return typeof seconds === "number" && seconds > 0 ? formatDate(new Date(seconds * 1000).toISOString()) : null;
}

/** "Last updated Nov 12, 2026 · restart pending": how the device's updates went; null when it does not say. */
export function screenUpdatesDetail(health: ScreenHealth | null | undefined, now: number): string | null {
  const updates = health?.metrics?.updates;
  if (updates === undefined || updates === null) return null;
  const lastSuccess = dateOf(field(updates, "last_success"));
  const parts = [lastSuccess ? `Last updated ${lastSuccess}` : "Not updated yet"];
  if (field(updates, "last_result") === "failed") parts.push("last attempt failed");
  if (field(updates, "reboot_pending") === true) parts.push("restart pending");
  const pausedUntil = field(updates, "paused_until");
  if (typeof pausedUntil === "number" && pausedUntil * 1000 > now) parts.push(`paused until ${dateOf(pausedUntil)}`);
  return parts.join(" · ");
}
