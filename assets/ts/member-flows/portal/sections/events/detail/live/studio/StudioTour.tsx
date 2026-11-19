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
    body: `Happy with the practice area? Press Transition, or the ${TAKE_SHORTCUT.toLowerCase()} bar, and it goes live in place of what was live before. The small arrows next to it are for the screens in the room: each one puts the practice area on that screen, exactly as it is.`,
  },
  {
    id: "sync",
    target: ".pk-studio-monitor__sync",
    title: "Screens follow what is live",
    body: "The projector and the speaker’s screen show what is live by themselves: that is Sync, the red PGM button on their monitor. The projector draws it in its own scene, and that scene decides which graphics show there. Click the button to turn Sync off, and that screen no longer changes with what is live. Click it again to turn Sync back on.",
  },
  {
    id: "screens",
    target: ".pk-menu__trigger:has(> .pk-live-screen-dots), .pk-studio-panel__body .pk-menu__trigger",
    title: "Screens in the room",
    body: "To show something on one screen only, open ⋯ on it and click Projector or Stage display; click again to take it off. A dot under ⋯ means it is on that screen and stays there. An empty circle means it is there while it is live, and leaves that screen when it goes off air.",
  },
  {
    id: "stage-display",
    target: panel("message"),
    title: "The speaker’s screen",
    body: "Type a short note here, like “5 minutes left”, and only the speaker sees it. While Sync is on, the speaker also sees the question you lined up in Preview, so they know what is coming.",
  },
  {
    id: "time",
    target: panel("time"),
    title: "Timers",
    body: "Here are the room’s timers, up to 12. The Session timer follows the agenda: it counts down to the start, then the session to its end, all by itself. Start, pause or add a minute to take over; Follow the agenda in its ⋯ hands it back.",
  },
  {
    id: "time-shown",
    target: panel("time"),
    title: "Which timers people see",
    body: "Viewers see every timer you put live. The speaker always sees the time of day, plus at most two countdowns: the one that ends first is the big one. When a countdown runs out, it fills the speaker’s screen.",
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
