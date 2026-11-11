/**
 * The room's screens at a glance for its operators: each one's latest
 * screenshot and its age, one line on its connection and issues, worst
 * screens first with their tone along the row's start, and the last hour of
 * latency and loss (stalls for a livestream). Screen managers also get
 * Identify and Reload; everyone else watches.
 */
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../../shared/live-room-outputs";
import type { ScreenMonitorStaffMessage } from "../../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../../shared/schemas/event-screens";
import { sortByScreenIssues, type ScreenIssue } from "../../../../../../../../shared/event-screen-issues";
import { RowActions } from "../../../../../../../ui/RowActions";
import type { ScreenMonitorView } from "../../screens/screen-monitor-view";
import { ScreenConditionLine, ScreenShot, screenCondition } from "../../screens/ScreenMonitorCard";
import { ScreenQualityTrend } from "../../screens/ScreenQualityTrend";
import "./ScreensPanel.css";

export function ScreensPanel({
  screens,
  monitor,
  issuesOf,
  now,
  onCommand,
}: {
  /** The room's screens, from the event's screen list filtered to this room. */
  screens: readonly ScreenRecord[];
  monitor: ScreenMonitorView;
  issuesOf: (screenId: string) => readonly ScreenIssue[];
  now: number;
  /** Identify and Reload, for screen managers only. */
  onCommand?: (type: ScreenMonitorStaffMessage["type"], screen: ScreenRecord) => void;
}) {
  if (!screens.length) return <p class="pk-studio-screens__empty">No screens show this room.</p>;
  return (
    <ul class="pk-studio-screens" aria-label="Screens">
      {sortByScreenIssues(screens, (screen) => issuesOf(screen.id)).map((screen) => {
        const status = monitor.live.get(screen.id);
        const online = Boolean(status?.online);
        const condition = screenCondition(screen, status, issuesOf(screen.id), now);
        return (
          <li key={screen.id} class="pk-studio-screens__row" data-tone={condition.tone}>
            <span class="pk-studio-screens__shot">
              <ScreenShot screen={screen} screenshot={monitor.screenshots.get(screen.id)} online={online} now={now} />
            </span>
            <span class="pk-studio-screens__name">{screen.name}</span>
            <span class="pk-studio-screens__output">
              {screen.assignment ? LIVE_SCREEN_OUTPUT_DETAILS[screen.assignment.output].label : "Not assigned"}
            </span>
            <span class="pk-studio-screens__status">
              <ScreenConditionLine condition={condition} />
            </span>
            <span class="pk-studio-screens__trend">
              <ScreenQualityTrend
                screenName={screen.name}
                samples={monitor.quality.get(screen.id) ?? []}
                livestream={screen.assignment?.output === "livestream"}
                now={now}
                compact
              />
            </span>
            {onCommand && (
              <span class="pk-studio-screens__actions">
                <RowActions
                  subject={screen.name}
                  actions={[
                    {
                      id: "identify",
                      label: "Identify",
                      disabled: !online,
                      onSelect: () => onCommand("screen.identify", screen),
                    },
                    {
                      id: "reload",
                      label: "Reload",
                      disabled: !online,
                      onSelect: () => onCommand("screen.reload", screen),
                    },
                  ]}
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
