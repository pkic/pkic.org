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
import { studioPhonePanel } from "../../member-flows/portal/sections/events/detail/live/studio/studio-phone-panels";
import { MONITOR_SOURCES } from "./sections-studio-on-screen";
import { RoomOpeningMenu } from "../../member-flows/portal/sections/events/detail/live/studio/RoomOpeningMenu";

const noCommand = () => undefined;
/** The Monitors view as a phone starts it: the room's screens under the Preview and Program thumbnails. */
const PHONE_MONITORS = studioPhonePanel("monitor");

/** The studio on a phone with its Monitors view open: its pictures of an output move without graphics layers. */
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
        sessionStatus={<RoomOpeningMenu opening="scheduled" disabled={false} send={() => true} />}
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
        eventPath="/events/pqc-2026"
        home={view.body}
        panel={() => view}
      />
    </div>
  );
}

export const studioPhoneSections: PreviewSection[] = [
  {
    id: "studio-phone-monitors",
    title: "Studio on a phone: thumbnails and monitors",
    note: "Open at phone width. Preview and Program sit at the top as thumbnails, with the Monitors view under them on the room's screens: the projector and the stage display. The monitors and the full-screen view move as the output does, drawn at half size to keep a phone's browser within its memory. The thumbnails hold still: a graphic cuts between its states, while the ticker still travels and a person's titles still take turns.",
    render: () => <PhoneStudio />,
  },
];
