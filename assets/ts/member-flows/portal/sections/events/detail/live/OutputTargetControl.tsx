import {
  LIVE_PREVIEW_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import type { LivePresenceTarget } from "../../../../../../../shared/live-room-presence";
import { Button } from "../../../../../../ui/Button";
import "../../../../../../ui/ButtonToggle.css";
import "./live-tally.css";
import "./presence/LivePresence.css";
import "./OutputTargetControl.css";

export type LiveDestination = "preview" | "program" | LiveAuxOutput;

/** Which output button an element is on, for operator presence. */
export function liveDestinationOf(element: Element): LivePresenceTarget | null {
  const destination = element.closest<HTMLElement>(".pk-output-target__button[data-destination]")?.dataset.destination;
  return destination === "preview" || destination === "program" ? destination : null;
}

/**
 * What PVW and PGM do, on hover. Preview is an optional check of the look and
 * the details before air; Program puts the graphic on air at once.
 */
export const OUTPUT_TARGET_HINTS = {
  preview: {
    off: "Preview: check how it looks and that the details are right before it goes on air. Optional.",
    on: "In Preview. Transition puts it on air; click to take it out of Preview.",
  },
  program: {
    off: "Program: put it on air now. Preview is not needed first.",
    on: "On air. Click to take it off air.",
  },
} as const;

/** The color slot of the first other operator on a button, which draws a ring in their color. */
function presenceOn(presence: readonly OutputTargetPresence[], target: LivePresenceTarget): number | undefined {
  return presence.find((mark) => mark.target === target)?.color;
}

/** Another operator on one of this control's buttons. Their name and initials sit beside the control. */
export interface OutputTargetPresence {
  target: LivePresenceTarget | null;
  color: number;
}

/**
 * Where one graphic goes, in words anyone running the room reads at once:
 * Preview (the next composition) and Program (what is on air), each a
 * toggle of its own, pressed where it is now. The room's screens are in the
 * row's menu, so the row keeps its width.
 */
export function OutputTargetControl({
  subject,
  preview,
  program,
  disabled,
  integrated = false,
  presenceItem,
  presence = [],
  onToggle,
}: {
  /** What the graphic is, for the controls' names: "Sam Speaker", "timer". */
  subject: string;
  preview: boolean;
  program: boolean;
  disabled: boolean;
  /** Spans the foot of a card instead of sitting inline. */
  integrated?: boolean;
  /** The graphic's presence id, so other operators see this operator on it. */
  presenceItem?: string;
  presence?: readonly OutputTargetPresence[];
  onToggle: (destination: LiveDestination) => void;
}) {
  return (
    <div
      class="pk-output-target pk-segmented"
      role="group"
      aria-label={`${subject} outputs`}
      data-integrated={integrated ? "true" : undefined}
      data-presence-item={presenceItem}
    >
      <Button
        class="pk-output-target__button"
        data-destination="preview"
        data-presence-color={presenceOn(presence, "preview")}
        aria-label={`Show ${subject} in preview`}
        title={OUTPUT_TARGET_HINTS.preview[preview ? "on" : "off"]}
        aria-pressed={preview}
        disabled={disabled}
        onClick={() => onToggle("preview")}
      >
        {LIVE_PREVIEW_OUTPUT_DETAILS.short}
      </Button>
      <Button
        class="pk-output-target__button"
        data-destination="program"
        data-presence-color={presenceOn(presence, "program")}
        aria-label={`Show ${subject} on air`}
        title={OUTPUT_TARGET_HINTS.program[program ? "on" : "off"]}
        aria-pressed={program}
        disabled={disabled}
        onClick={() => onToggle("program")}
      >
        {LIVE_PROGRAM_OUTPUT_DETAILS.short}
      </Button>
    </div>
  );
}
