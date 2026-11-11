/**
 * Everything a staff view of the event's screens needs from the monitor:
 * the live view, each screen's issues on a clock that keeps their ages
 * current, Identify and Reload for screen managers, and the browser
 * notification. The gallery hands in a fixed view and clock instead of a
 * connection.
 */
import { useCallback, useMemo, useRef } from "preact/hooks";
import type { ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import type { ScreenMonitorStaffMessage } from "../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../shared/schemas/event-screens";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import { screenMonitorIssues, type ScreenMonitorView } from "./screen-monitor-view";
import { useScreenIssueNotifications } from "./useScreenIssueNotifications";
import { useScreenMonitorStaff } from "./useScreenMonitorStaff";
import type { LiveSocketFactory } from "../../../../../../live-session/useLiveRoom";

/** Issues read against a clock that moves every five seconds, so a late heartbeat shows within the window. */
const nextTick = (now: number) => now - (now % 5_000) + 5_000;
const NO_ISSUES: readonly ScreenIssue[] = [];

export interface ScreenMonitorFixture {
  view: ScreenMonitorView;
  now: number;
  control: boolean;
}

export function useScreenMonitorController({
  slug,
  fixture,
  enabled = true,
  only,
  ready = true,
  createSocket,
}: {
  slug: string;
  fixture?: ScreenMonitorFixture;
  /** Off while nothing on the page shows screens. */
  enabled?: boolean;
  /** Only these screens' issues count, as in a studio for one room. */
  only?: ReadonlySet<string>;
  /** The caller's own data is in, so issues present now are already known rather than new. */
  ready?: boolean;
  /** The monitor connection's socket, replaced in tests. */
  createSocket?: LiveSocketFactory;
}) {
  const staff = useScreenMonitorStaff({ slug, enabled: enabled && !fixture, createSocket });
  const clock = useBoundaryClock(nextTick);
  // Every age, staleness and "since" is read on the monitor's clock, whatever this browser's says.
  const now = fixture?.now ?? clock + staff.clockOffsetMs;
  // A refused connection shows only what the screen list recorded.
  const view = fixture?.view ?? (staff.status === "refused" ? undefined : staff.view);
  /**
   * The connection dropped after the monitor had spoken: its last view stays
   * on screen for its pictures and trends, but nothing in it counts as now.
   */
  const lostSince = !fixture && staff.status !== "live" && staff.status !== "refused" ? staff.lastUpdateAt : null;
  const issues = useMemo(() => {
    const all = view && lostSince === null ? screenMonitorIssues(view, now) : new Map<string, ScreenIssue[]>();
    return only ? new Map([...all].filter(([screenId]) => only.has(screenId))) : all;
  }, [view, now, only, lostSince]);
  /** Names of the screens this view has listed, for notifications about screens on another page. */
  const names = useRef(new Map<string, string>());
  const notifications = useScreenIssueNotifications({
    issues,
    ready: ready && (Boolean(fixture) || staff.status === "live"),
    nameOf: (screenId) => names.current.get(screenId) ?? screenId,
  });
  const remember = useCallback((screens: readonly ScreenRecord[]) => {
    for (const screen of screens) names.current.set(screen.id, screen.name);
  }, []);
  const control = fixture?.control ?? staff.control;
  const command: ((type: ScreenMonitorStaffMessage["type"], screen: ScreenRecord) => void) | undefined = control
    ? fixture
      ? () => undefined
      : staff.command
    : undefined;
  return {
    view,
    now,
    /** When the monitor last spoke, on its clock, while the connection is lost; null while it is live. */
    lostSince,
    issues,
    issuesOf: (screenId: string) => issues.get(screenId) ?? NO_ISSUES,
    command,
    notifications,
    remember,
  };
}
