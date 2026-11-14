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
    title: "Practice and live",
    body: "The green picture (Preview) is your practice area. Only the people running the studio see it. The red picture (Program) is live: everyone watching sees it.",
  },
  {
    id: "outputs",
    target: ".pk-output-target",
    title: "Show something",
    body: "Every item has two buttons. PGM shows it to everyone right away. PVW puts it in the practice area first, so you can check the names, photos and spelling. Practicing first is up to you.",
  },
  {
    id: "transition",
    target: panel("transition"),
    title: "Go live with your practice",
    body: `Happy with the practice area? Press Transition, or the ${TAKE_SHORTCUT.toLowerCase()} bar, and it goes live in place of what was live before. The small arrow next to it sends it to a screen in the room instead.`,
  },
  {
    id: "screens",
    target: ".pk-menu__trigger:has(> .pk-live-screen-dots), .pk-studio-panel__body .pk-menu__trigger",
    title: "Screens in the room",
    body: "The room has a projector for the audience and a screen for the speaker. Open ⋯ on an item to show it there. A dot under ⋯ means it is on one of them. An empty circle means the speaker’s screen shows it by itself, because it is live.",
  },
  {
    id: "stage-display",
    target: panel("message"),
    title: "The speaker’s screen",
    body: "The speaker’s screen shows the time, plus any question, poll or timer that is live. Type a short note here, like “5 minutes left”, and only the speaker sees it.",
  },
  {
    id: "time",
    target: panel("time"),
    title: "Timers",
    body: "Start, pause, or add a minute here. When a timer is live, the speaker sees it counting down.",
  },
  {
    id: "layout",
    target: ".pk-studio-toolbar",
    title: "Arrange your studio",
    body: "Drag a panel by its title to move it. Add panels or start over here. Press Studio tour any time to see this again.",
  },
];

export function StudioTour({ scope, onClose }: { scope: RefObject<HTMLElement>; onClose: () => void }) {
  return <GuidedTour scope={scope} steps={STUDIO_TOUR_STEPS} onClose={onClose} />;
}
