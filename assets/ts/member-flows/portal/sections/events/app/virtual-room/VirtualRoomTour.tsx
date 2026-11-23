import type { RefObject } from "preact";
import { useRef, useState } from "preact/hooks";
import { GuidedTour, type GuidedTourStep } from "../../../../../../ui/GuidedTour";

const SEEN_KEY = "virtual-room-tour-seen";

/** Whether this device has shown the room's tour. Blocked storage counts as shown, so the tour never opens on every visit. */
function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "yes";
  } catch {
    return true;
  }
}

function rememberTourSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "yes");
  } catch {
    // A private window forgets it, and opens the tour again next time.
  }
}

/** The room's tour: open by itself on a device's first visit, and again from the room's help button. */
export function useRoomTour(firstVisit: boolean) {
  const [open, setOpen] = useState(false);
  // The room mounts hidden while the attendee is elsewhere in the event; the tour waits until it is in view.
  const checked = useRef(false);
  if (firstVisit && !checked.current) {
    checked.current = true;
    if (!tourSeen()) {
      rememberTourSeen();
      setOpen(true);
    }
  }
  return { open, toggle: () => setOpen((value) => !value), close: () => setOpen(false) };
}

/** The phone's bottom bar, as AppTabBar.css shows it. */
const BOTTOM_BAR_QUERY = "(max-width: 48rem)";

/**
 * Where each room panel is reached: beside the stream on a desktop, otherwise on the phone's bottom bar or,
 * between a phone and a desktop, on the room's own tabs.
 */
function panelTarget(wide: boolean, panel: "questions" | "chat" | "agenda", wideTarget: string) {
  if (wide) return wideTarget;
  return window.matchMedia(BOTTOM_BAR_QUERY).matches
    ? `.pk-app-tabbar [data-app-tab="${panel}"]`
    : `#virtual-room-tab-${panel}`;
}

function roomTourSteps(wide: boolean): GuidedTourStep[] {
  return [
    {
      id: "locations",
      target: 'nav[aria-label="Locations"]',
      title: "Choose a location",
      body: "Each location has its own tab. A crossed-out camera means it is not streamed, but you can still ask questions and chat there.",
    },
    {
      id: "stream",
      target: ".pk-virtual-room__player, .pk-virtual-room__in-room",
      title: "Watch the session",
      body: "The location’s stream plays here. Under it you see which session is on and who is speaking.",
    },
    {
      id: "questions",
      target: panelTarget(wide, "questions", '.pk-virtual-room__side [aria-label="Questions and polls"]'),
      title: "Ask the speakers",
      body: "Ask a question, or vote for the ones you want answered. Polls appear here during a session.",
    },
    {
      id: "chat",
      target: panelTarget(wide, "chat", ".pk-virtual-room__side [aria-labelledby=virtual-room-chat-title]"),
      title: "Chat with everyone",
      body: "Talk with everyone following this location today.",
    },
    {
      id: "agenda",
      target: panelTarget(wide, "agenda", ".pk-virtual-room__main .pk-content-agenda"),
      title: "See what is next",
      body: "The event’s agenda, so you can plan which session to join next.",
    },
    {
      id: "full",
      target: '[data-room-tour="full"]',
      title: "Go full screen",
      body: "Fill the window with the stream, the questions and the chat. Press Esc to go back.",
    },
    {
      id: "help",
      target: '[data-room-tour="help"]',
      title: "Take the tour again",
      body: "Open this tour any time with the question mark.",
    },
  ];
}

export function VirtualRoomTour({
  scope,
  wide,
  onClose,
}: {
  scope: RefObject<HTMLElement>;
  wide: boolean;
  onClose: () => void;
}) {
  return <GuidedTour scope={scope} steps={roomTourSteps(wide)} onClose={onClose} />;
}
