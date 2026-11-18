/**
 * The studio's output controls: PVW and PGM on a graphic's row, held but
 * unseen, the room screens a graphic was put on, a press the room has not
 * answered yet, and the take buttons for Program and each screen.
 */
import type { PreviewSection } from "./PreviewShell";
import { DEFAULT_LIVE_ROOM_OUTPUTS } from "../../../shared/schemas/live-room-output-setup";
import { OutputTargetControl } from "../../member-flows/portal/sections/events/detail/live/OutputTargetControl";
import { LiveScreenTags, NO_LIVE_SCREENS } from "../../member-flows/portal/sections/events/detail/live/LiveRowMenu";
import { LiveGraphicRow } from "../../member-flows/portal/sections/events/detail/live/LiveGraphicRow";
import { TransitionControl } from "../../member-flows/portal/sections/events/detail/live/studio/StudioSwitcher";
import { GALLERY_ROOM_SCREENS } from "./studio-on-screen-fixtures";

export const studioOutputSections: PreviewSection[] = [
  {
    id: "studio-output-target-covered",
    title: "Held, but unseen",
    note: "PVW and PGM stay lit while an output holds the graphic; hatched when nobody sees it there, under a board such as the question or left out of the scene. The row's summary says why in words, and the tooltip says what shows it.",
    render: () => (
      <div class="pk-stack">
        <div class="pk-cluster">
          <OutputTargetControl
            subject="Up next"
            preview={false}
            program={false}
            disabled={false}
            onToggle={() => undefined}
          />
          <OutputTargetControl subject="Up next" preview program disabled={false} onToggle={() => undefined} />
          <OutputTargetControl
            subject="Up next"
            preview
            program
            previewUnseen={{ reason: "scene", scene: "Panel" }}
            programUnseen={{ reason: "covered", by: "Question" }}
            disabled={false}
            onToggle={() => undefined}
          />
        </div>
        <LiveGraphicRow name="Up next" detail="Next: Opening keynote" unseen="On air · covered by Question" />
      </div>
    ),
  },
  {
    id: "studio-output-target-where",
    title: "Room screens and a press on its way",
    note: "Beside PVW and PGM, the code of each room screen the graphic was put on, in that screen's tally color. A pressed button the room has not answered yet spins and takes no second press, so a slow answer never reads as a frozen click.",
    render: () => (
      <div class="pk-cluster">
        <LiveScreenTags screens={{ ...NO_LIVE_SCREENS, on: ["projector", "stage-display"] }} />
        <OutputTargetControl subject="Check-in code" preview program disabled={false} onToggle={() => undefined} />
        <OutputTargetControl
          subject="Check-in code"
          preview
          program={false}
          pending={(destination) => destination === "program"}
          disabled={false}
          onToggle={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "studio-transition",
    title: "Transition to Program or to a screen",
    note: "One take button per screen, stacked, each in its tally color. Program is first and runs on Space. A screen that follows Program takes a shot too and keeps Program's graphics where the shot has none. Labeled, the buttons spell out the screen.",
    render: () => (
      <div class="pk-cluster">
        <TransitionControl
          outputs={GALLERY_ROOM_SCREENS}
          disabled={false}
          transitioning={null}
          onTransition={() => undefined}
        />
        <TransitionControl
          outputs={GALLERY_ROOM_SCREENS}
          disabled={false}
          transitioning="foy"
          labeled
          onTransition={() => undefined}
        />
        <TransitionControl
          outputs={GALLERY_ROOM_SCREENS}
          disabled
          transitioning={null}
          onTransition={() => undefined}
        />
        <TransitionControl
          outputs={DEFAULT_LIVE_ROOM_OUTPUTS}
          disabled={false}
          transitioning={null}
          onTransition={() => undefined}
        />
      </div>
    ),
  },
];
