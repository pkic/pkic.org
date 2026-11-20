/**
 * The studio's session bar: the session, its timing, whether it is loaded, and whether attendees take part
 * in its virtual room.
 */
import type { PreviewSection } from "./PreviewShell";
import type { LiveRoomOpening } from "../../../shared/schemas/live-room-opening";
import { RoomOpeningMenu } from "../../member-flows/portal/sections/events/detail/live/studio/RoomOpeningMenu";
import { StudioHeader } from "../../member-flows/portal/sections/events/detail/live/studio/StudioHeader";
import { MONITOR_SOURCES } from "./sections-studio-on-screen";

const noCommand = () => true;

function SessionBar({ opening }: { opening: LiveRoomOpening }) {
  const state = { ...MONITOR_SOURCES.preview, opening };
  return (
    <div class="pk-studio">
      <div class="pk-panel pk-studio__bar">
        <StudioHeader
          state={state}
          clock="UTC"
          active
          notice={null}
          sessionStatus={
            <>
              <span role="status">
                <span class="pk-studio-header__active">Loaded</span>
              </span>
              <RoomOpeningMenu opening={opening} disabled={false} send={noCommand} />
            </>
          }
        />
      </div>
    </div>
  );
}

export const studioSessionBarSections: PreviewSection[] = [
  {
    id: "studio-session-bar",
    title: "Studio session bar: the virtual room",
    note: "Beside Loaded, operators choose whether attendees take part in the session's virtual room: on schedule, open now (to test it, or to let a discussion run on) or closed. The choice holds until someone changes it or loads another session. The virtual room follows the loaded session.",
    render: () => (
      <div class="pk-stack">
        <SessionBar opening="scheduled" />
        <SessionBar opening="open" />
      </div>
    ),
  },
];
