import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_STUDIO_AUX_OUTPUTS,
  LIVE_PREVIEW_OUTPUT_DETAILS,
  LIVE_PROGRAM_OUTPUT_DETAILS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import type { LivePresenceTarget } from "../../../../../../../shared/live-room-presence";
import { Button } from "../../../../../../ui/Button";
import { buttonClasses } from "../../../../../../ui/button-classes";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";
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

/** A screen icon when on none, else the screens' switcher abbreviations: PRJ, or PRJ DSP. */
function auxLabel(active: readonly LiveAuxOutput[]) {
  if (active.length) return active.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].short).join(" ");
  return (
    <StrokeIcon>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M6 14h4M8 11v3" />
    </StrokeIcon>
  );
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
  const active = LIVE_STUDIO_AUX_OUTPUTS.filter((output) => aux(output));
  return (
    <div
      class="pk-output-target pk-segmented"
      role="group"
      aria-label={`${subject} outputs`}
      data-integrated={integrated ? "true" : undefined}
      data-aux-active={active[0]}
      data-presence-item={presenceItem}
      data-presence-aux={presenceOn(presence, "aux")}
    >
      <Button
        class="pk-output-target__button"
        data-destination="preview"
        data-presence-color={presenceOn(presence, "preview")}
        aria-label={`Show ${subject} in preview`}
        title={LIVE_PREVIEW_OUTPUT_DETAILS.label}
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
        title={LIVE_PROGRAM_OUTPUT_DETAILS.label}
        aria-pressed={program}
        disabled={disabled}
        onClick={() => onToggle("program")}
      >
        {LIVE_PROGRAM_OUTPUT_DETAILS.short}
      </Button>
      <Menu
        variant="plain"
        align="end"
        label={`Send ${subject} to the room's screens`}
        title={
          active.length ? `On ${active.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].label).join(", ")}` : "Screens"
        }
        triggerClass={buttonClasses({}, `pk-output-target__button ${AUX_TRIGGER}`)}
        heading="Show on"
        items={LIVE_STUDIO_AUX_OUTPUTS.map((output) => ({
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
