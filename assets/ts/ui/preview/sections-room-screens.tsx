/**
 * A room's screens in Event settings: the table of Program and the screens
 * the room sets up, with their links, and the dialog that adds or changes one.
 * Saving changes only the specimen's own list, so nothing is sent.
 */
import { useState } from "preact/hooks";
import { liveOverlayLayoutChoices } from "../../../shared/live-overlay-layout-presets";
import type { LiveRoomOutput, LiveRoomOutputInput } from "../../../shared/schemas/live-room-output-setup";
import { liveOverlayAddress } from "../../live-session/live-overlay-address";
import { LiveRoomScreenDialog } from "../../member-flows/portal/sections/events/detail/live/LiveRoomScreenDialog";
import { LiveRoomScreens } from "../../member-flows/portal/sections/events/detail/live/LiveRoomScreens";
import type { PreviewSection } from "./PreviewShell";
import { DialogSpecimen } from "./sections-event-screens-staff";
import { GALLERY_ROOM_SCREENS } from "./studio-on-screen-fixtures";

const SCENES = liveOverlayLayoutChoices([]);

/** Gives each new screen a key from its code, as the room does. */
const keyed = (outputs: readonly LiveRoomOutputInput[]): LiveRoomOutput[] =>
  outputs.map((output) => ({ ...output, key: output.key ?? output.code.toLowerCase().replace(/\s+/g, "-") }));

function RoomScreens() {
  const [screens, setScreens] = useState<LiveRoomOutput[]>([...GALLERY_ROOM_SCREENS]);
  return (
    <LiveRoomScreens
      screens={screens}
      scenes={SCENES}
      expiresAt="2026-12-04T17:00:00.000Z"
      link={(view, graphics) =>
        liveOverlayAddress("https://pkic.org", {
          view,
          layout: null,
          slug: "pqc-conference-2026",
          roomId: "33333333-3333-4333-8333-333333333333",
          token: "signed.overlay.access",
          graphics,
        })
      }
      onSave={async (outputs) => setScreens(keyed(outputs))}
    />
  );
}

export const roomScreensSections: PreviewSection[] = [
  {
    id: "live-room-screens",
    title: "Screens in this room",
    note: "Program, then each screen the room sets up: its code in its tally color, its role and what that shows, its scene, and its link. The speaker's screen draws its own layout, so it has no graphics to choose.",
    render: () => <RoomScreens />,
  },
  {
    id: "live-room-screen-dialog",
    title: "Add screen",
    note: "Name, code, role and scene. The speaker's role stays closed while another screen holds it; a code in use says so on the field before anything is sent.",
    render: () => (
      <DialogSpecimen
        label="+ Add screen"
        dialog={(close) => (
          <LiveRoomScreenDialog
            screens={GALLERY_ROOM_SCREENS}
            editing={null}
            scenes={SCENES}
            onSave={async () => undefined}
            onClose={close}
          />
        )}
      />
    ),
  },
];
