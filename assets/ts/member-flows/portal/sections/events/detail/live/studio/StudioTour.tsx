import type { RefObject } from "preact";
import { GuidedTour, type GuidedTourStep } from "../../../../../../../ui/GuidedTour";
import { TAKE_SHORTCUT } from "./StudioSwitcher";

const panel = (type: string) => `[data-presence-panel="${type}"]`;

/**
 * How the studio works, step by step, for anyone new to running a room.
 * A step whose panel is closed in this layout is left out.
 */
export const STUDIO_TOUR_STEPS: readonly GuidedTourStep[] = [
  {
    id: "monitors",
    target: panel("monitor"),
    title: "Watch the outputs",
    body: "Preview (PVW, green) is what you prepare next. Program (PGM, red) is the graphics on air. Choose outputs on a monitor to also watch the projector, the stage display or the livestream.",
  },
  {
    id: "outputs",
    target: ".pk-output-target",
    title: "PVW and PGM on every row",
    body: "PGM puts a graphic on air at once. PVW is an optional check: see that it fits and that the session, names and headshots are right before air. A row's edge turns green in Preview and red on air.",
  },
  {
    id: "transition",
    target: panel("transition"),
    title: "Transition",
    body: `Transition replaces Program with Preview in one move. Press ${TAKE_SHORTCUT} when no field has focus. Use the arrow beside it to send Preview to the projector or the stage display instead.`,
  },
  {
    id: "screens",
    target: ".pk-menu__trigger:has(> .pk-live-screen-dots), .pk-studio-panel__body .pk-menu__trigger",
    title: "The room's screens",
    body: "Each row's ⋯ menu puts the graphic on the projector or the stage display, separately from Program. A dot under ⋯ shows each screen it is on. A ring means the stage display shows it because it is on Program.",
  },
  {
    id: "stage-display",
    target: panel("message"),
    title: "The speaker's stage display",
    body: "The stage display shows the clock, the timers and the question or poll on Program, unless you put one there yourself. The next question in Preview is shown as next. Write a message here to show it to the speaker.",
  },
  {
    id: "time",
    target: panel("time"),
    title: "Timers",
    body: "Start, pause and adjust timers here. The stage display always shows the countdowns on Program, so the speaker sees the time left.",
  },
  {
    id: "layout",
    target: ".pk-studio-toolbar",
    title: "Make the studio yours",
    body: "Switch layouts, add or reset panels, and drag a panel's header to move it. Your layout is kept on this device. Open Studio tour here whenever you want to see this again.",
  },
];

export function StudioTour({ scope, onClose }: { scope: RefObject<HTMLElement>; onClose: () => void }) {
  return <GuidedTour scope={scope} steps={STUDIO_TOUR_STEPS} onClose={onClose} />;
}
