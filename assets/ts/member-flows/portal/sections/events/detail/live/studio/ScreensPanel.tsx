/**
 * The room's screens at a glance for its operators: whether each is online,
 * what it actually draws and how its device is doing. Screen managers also
 * get Identify and Reload; everyone else watches.
 */
import { screenConnection, screenConnectionDisplay } from "../../../../../../../../shared/event-screen-connection";
import { screenHealthDisplay } from "../../../../../../../../shared/event-screen-health";
import { LIVE_SCREEN_OUTPUT_DETAILS } from "../../../../../../../../shared/live-room-outputs";
import type {
  ScreenLiveStatus,
  ScreenMonitorStaffMessage,
} from "../../../../../../../../shared/schemas/event-screen-monitor";
import type { ScreenRecord } from "../../../../../../../../shared/schemas/event-screens";
import { Badge } from "../../../../../../../ui/Badge";
import { RowActions } from "../../../../../../../ui/RowActions";
import { screenHealthDetail } from "../../screens/ScreenHealthCell";
import "./ScreensPanel.css";

function ScreenShows({ screen, live }: { screen: ScreenRecord; live: ScreenLiveStatus | undefined }) {
  if (live?.online && live.health) {
    const { label, tone } = screenHealthDisplay(live.health);
    return tone ? <Badge tone={tone}>{label}</Badge> : <>{label}</>;
  }
  return <>{screen.assignment ? LIVE_SCREEN_OUTPUT_DETAILS[screen.assignment.output].label : "Not assigned"}</>;
}

function ScreenConnection({ screen, live, now }: { screen: ScreenRecord; live?: ScreenLiveStatus; now: number }) {
  if (live?.online) return <>Online</>;
  const { label, tone } = screenConnectionDisplay(screenConnection(screen.session, now));
  return tone ? <Badge tone={tone}>{label}</Badge> : <>{label}</>;
}

export function ScreensPanel({
  screens,
  live,
  now,
  onCommand,
}: {
  /** The room's screens, from the event's screen list filtered to this room. */
  screens: readonly ScreenRecord[];
  live: ReadonlyMap<string, ScreenLiveStatus>;
  now: number;
  /** Identify and Reload, for screen managers only. */
  onCommand?: (type: ScreenMonitorStaffMessage["type"], screen: ScreenRecord) => void;
}) {
  if (!screens.length) return <p class="pk-studio-screens__empty">No screens show this room.</p>;
  return (
    <ul class="pk-studio-screens" aria-label="Screens">
      {screens.map((screen) => {
        const status = live.get(screen.id);
        const detail = status?.online ? screenHealthDetail(status) : "";
        return (
          <li key={screen.id} class="pk-studio-screens__row">
            <span class="pk-studio-screens__name">{screen.name}</span>
            <span class="pk-studio-screens__status">
              <ScreenConnection screen={screen} live={status} now={now} />
            </span>
            <span class="pk-studio-screens__shows">
              <ScreenShows screen={screen} live={status} />
            </span>
            <span class="pk-studio-screens__detail">{detail || <span class="pk-mono">{screen.id}</span>}</span>
            {onCommand && (
              <span class="pk-studio-screens__actions">
                <RowActions
                  subject={screen.name}
                  actions={[
                    {
                      id: "identify",
                      label: "Identify",
                      disabled: !status?.online,
                      onSelect: () => onCommand("screen.identify", screen),
                    },
                    {
                      id: "reload",
                      label: "Reload",
                      disabled: !status?.online,
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
