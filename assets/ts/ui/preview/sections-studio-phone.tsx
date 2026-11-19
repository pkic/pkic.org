/**
 * The studio on a phone: Preview and Program as thumbnails at the top, the
 * Transition between them, and one panel below.
 */
import type { PreviewSection } from "./PreviewShell";
import { DEFAULT_LIVE_ROOM_OUTPUTS } from "../../../shared/schemas/live-room-output-setup";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../../shared/schemas/live-screen-sync";
import { monitorPanelView } from "../../member-flows/portal/sections/events/detail/live/studio/MonitorPanel";
import { StudioPhone } from "../../member-flows/portal/sections/events/detail/live/studio/StudioPhone";
import { TransitionControl } from "../../member-flows/portal/sections/events/detail/live/studio/StudioSwitcher";
import type { StudioPanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-layout";
import { MONITOR_SOURCES } from "./sections-studio-on-screen";

const noCommand = () => undefined;
const PHONE_MONITORS: StudioPanel = {
  id: "phone-monitor",
  type: "monitor",
  x: 0,
  y: 0,
  w: 12,
  h: 8,
  outputs: ["preview", "program"],
};

/** The studio on a phone with its Monitors view open: every picture of an output holds still there. */
function PhoneStudio() {
  const view = monitorPanelView(PHONE_MONITORS, MONITOR_SOURCES, noCommand, {
    clear: noCommand,
    screenSync: DEFAULT_LIVE_SCREEN_SYNC,
    sync: noCommand,
    previewScene: noCommand,
    screenScene: noCommand,
    disabled: false,
  });
  return (
    <div class="pk-studio" data-phone="">
      <StudioPhone
        state={MONITOR_SOURCES.preview}
        sources={MONITOR_SOURCES}
        clock="UTC"
        active
        transition={
          <TransitionControl
            outputs={DEFAULT_LIVE_ROOM_OUTPUTS}
            disabled={false}
            transitioning={null}
            onTransition={noCommand}
          />
        }
        disabled={false}
        onClear={noCommand}
        onScene={noCommand}
        notice={null}
        home={view.body}
        panel={() => view}
      />
    </div>
  );
}

export const studioPhoneSections: PreviewSection[] = [
  {
    id: "studio-phone-monitors",
    title: "Studio on a phone: thumbnails and monitors hold still",
    note: "Open at phone width. Preview and Program sit at the top as thumbnails, with the Monitors view under them. No picture moves here: a scrolling ticker or a rotating title in each one would cost a phone's browser more memory than it has. The outputs themselves move as always.",
    render: () => <PhoneStudio />,
  },
];
