import {
  LIVE_PREVIEW_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import type { LivePresenceTarget } from "../../../../../../../shared/live-room-presence";
import { Button } from "../../../../../../ui/Button";
import { liveLayerUnseenWords, type LiveLayerUnseen } from "./live-layer-unseen";
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
 * What PVW and PGM say on hover: where the graphic is, then what a click
 * does. Preview is an optional check of the look and the details before air;
 * Program puts the graphic on air at once.
 */
export const OUTPUT_TARGET_HINTS = {
  preview: {
    off: "Not in Preview\nClick to check how it looks and that the details are right before it goes on air. Optional.",
    on: "In Preview\nTransition puts it on air. Click to take it out of Preview.",
  },
  program: {
    off: "Off air\nClick to put it on air now. Preview is not needed first.",
    on: "On air\nClick to take it off air.",
  },
} as const;

/** Why nobody sees it there, and what shows it, after the output's own state. */
function unseenHint(destination: "preview" | "program", unseen: LiveLayerUnseen): string {
  const lead = `${destination === "preview" ? "In Preview" : "On air"} · ${liveLayerUnseenWords(unseen)}`;
  const why =
    unseen.reason === "covered"
      ? `${unseen.by} is drawn over it, so nobody ${destination === "preview" ? "would see" : "sees"} it.`
      : `The ${unseen.scene} scene does not show it, so nobody ${destination === "preview" ? "would see" : "sees"} it.`;
  const next =
    destination === "preview"
      ? "Click to take it out of Preview."
      : unseen.reason === "covered"
        ? `Take ${unseen.by} off air to show it, or click to take this off air.`
        : "Load a scene that shows it and transition, or click to take it off air.";
  return `${lead}\n${why} ${next}`;
}

/** The hint of one output button for the graphic's state there. */
export function outputTargetHint(
  destination: "preview" | "program",
  on: boolean,
  unseen: LiveLayerUnseen | null = null,
): string {
  if (on && unseen) return unseenHint(destination, unseen);
  return OUTPUT_TARGET_HINTS[destination][on ? "on" : "off"];
}

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
  previewUnseen = null,
  programUnseen = null,
  disabled,
  pending = () => false,
  integrated = false,
  presenceItem,
  presence = [],
  onToggle,
}: {
  /** What the graphic is, for the controls' names: "Sam Speaker", "timer". */
  subject: string;
  preview: boolean;
  program: boolean;
  /** Why Preview holds it unseen; its PVW button then reads held but unseen. */
  previewUnseen?: LiveLayerUnseen | null;
  /** Why it is on air unseen, such as a question drawn over it; its PGM button then reads on air but unseen. */
  programUnseen?: LiveLayerUnseen | null;
  disabled: boolean;
  /** Whether a press sent to this output waits for the room's answer: its button shows it is working. */
  pending?: (destination: "preview" | "program") => boolean;
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
        data-unseen={preview && previewUnseen ? "" : undefined}
        title={outputTargetHint("preview", preview, previewUnseen)}
        aria-pressed={preview}
        disabled={disabled}
        loading={pending("preview")}
        onClick={() => onToggle("preview")}
      >
        {LIVE_PREVIEW_OUTPUT_DETAILS.short}
      </Button>
      <Button
        class="pk-output-target__button"
        data-destination="program"
        data-presence-color={presenceOn(presence, "program")}
        aria-label={`Show ${subject} on air`}
        data-unseen={program && programUnseen ? "" : undefined}
        title={outputTargetHint("program", program, programUnseen)}
        aria-pressed={program}
        disabled={disabled}
        loading={pending("program")}
        onClick={() => onToggle("program")}
      >
        {LIVE_PROGRAM_OUTPUT_DETAILS.short}
      </Button>
    </div>
  );
}
