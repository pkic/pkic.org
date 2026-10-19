import {
  LIVE_AUX_OUTPUTS,
  LIVE_AUX_OUTPUT_DETAILS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import type { LivePresenceTarget } from "../../../../../../../shared/live-room-presence";
import { Button } from "../../../../../../ui/Button";
import { buttonClasses } from "../../../../../../ui/button-classes";
import { Menu } from "../../../../../../ui/Menu";
import "../../../../../../ui/ButtonToggle.css";
import "./live-tally.css";
import "./presence/LivePresence.css";
import "./OutputTargetControl.css";

export type LiveDestination = "preview" | "program" | LiveAuxOutput;

const AUX_TRIGGER = "pk-output-target__aux";

/** Which output button an element is on, for operator presence; the aux menu counts as one. */
export function liveDestinationOf(element: Element): LivePresenceTarget | null {
  const destination = element.closest<HTMLElement>(".pk-output-target__button[data-destination]")?.dataset.destination;
  if (destination === "preview" || destination === "program") return destination;
  return element.closest(`.${AUX_TRIGGER}`) ? "aux" : null;
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

/** "Screens" when on none, the screen's name for one, and how many when several. */
function auxLabel(active: readonly LiveAuxOutput[]): string {
  if (!active.length) return "Screens";
  return active.length === 1 ? LIVE_AUX_OUTPUT_DETAILS[active[0]].label : `${active.length} screens`;
}

/**
 * Where one graphic goes, in words anyone running the room reads at once:
 * Preview (the next composition), Program (what is on air) and the room's
 * other screens, chosen together in one menu. Each destination toggles on
 * its own; pressed buttons and checked items say where it is now.
 */
export function OutputTargetControl({
  subject,
  preview,
  program,
  aux,
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
  aux: (output: LiveAuxOutput) => boolean;
  disabled: boolean;
  /** Spans the foot of a card instead of sitting inline. */
  integrated?: boolean;
  /** The graphic's presence id, so other operators see this operator on it. */
  presenceItem?: string;
  presence?: readonly OutputTargetPresence[];
  onToggle: (destination: LiveDestination) => void;
}) {
  const active = LIVE_AUX_OUTPUTS.filter((output) => aux(output));
  return (
    <div
      class="pk-output-target pk-segmented"
      role="group"
      aria-label={`${subject} outputs`}
      data-integrated={integrated ? "true" : undefined}
      data-aux-active={active.length ? "true" : undefined}
      data-presence-item={presenceItem}
      data-presence-aux={presenceOn(presence, "aux")}
    >
      <Button
        class="pk-output-target__button"
        data-destination="preview"
        data-presence-color={presenceOn(presence, "preview")}
        aria-label={`Show ${subject} in preview`}
        title="Show in preview, ready to put on air"
        aria-pressed={preview}
        disabled={disabled}
        onClick={() => onToggle("preview")}
      >
        Preview
      </Button>
      <Button
        class="pk-output-target__button"
        data-destination="program"
        data-presence-color={presenceOn(presence, "program")}
        aria-label={`Show ${subject} on air`}
        title="Show on air now, on the program output"
        aria-pressed={program}
        disabled={disabled}
        onClick={() => onToggle("program")}
      >
        Program
      </Button>
      <Menu
        variant="plain"
        align="end"
        label={`Send ${subject} to the room's screens`}
        title={
          active.length
            ? `On ${active.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].label).join(", ")}`
            : "Show on the projector or the stage screens"
        }
        triggerClass={buttonClasses({}, `pk-output-target__button ${AUX_TRIGGER}`)}
        heading="Show on"
        items={LIVE_AUX_OUTPUTS.map((output) => ({
          id: output,
          label: LIVE_AUX_OUTPUT_DETAILS[output].label,
          checked: aux(output),
          multiple: true,
          keepOpen: true,
          disabled,
          onSelect: () => onToggle(output),
        }))}
      >
        {auxLabel(active)}
        <span aria-hidden="true"> ▾</span>
      </Menu>
    </div>
  );
}
