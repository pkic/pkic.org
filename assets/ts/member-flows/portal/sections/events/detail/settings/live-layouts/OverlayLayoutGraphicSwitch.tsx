import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  LIVE_OVERLAY_ELEMENT_SWITCHES,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { Button } from "../../../../../../../ui/Button";
import { IconBolt, StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { LAYOUT_SWITCH_CHOICES, describeGraphicSwitch, layoutSwitchChoice } from "./overlay-layout-copy";
import "./OverlayLayouts.css";

/** A pointer on a list: the graphic comes on when someone picks one of its items in the studio. */
function PickIcon() {
  return (
    <StrokeIcon>
      <path d="M2.5 3.5h7M2.5 6.5h5M2.5 9.5h3" />
      <path d="m9 8 4.5 2-2 .8-.8 2.2z" />
    </StrokeIcon>
  );
}

/**
 * What puts a graphic on in this scene, as one icon beside its name, with
 * the words in its tooltip. A graphic that fills itself from the room
 * carries the scene's one choice as a toggle: pressed, it comes on with the
 * scene; released, it is switched in the studio. Every other graphic shows
 * how it is switched, with nothing to choose. Without `onComesOn` the
 * choice is only read.
 */
export function OverlayLayoutGraphicSwitch({
  element,
  placement,
  disabled = false,
  onComesOn,
}: {
  element: LiveOverlayElement;
  placement: Pick<LiveOverlayElementPlacement, "comesOn">;
  disabled?: boolean;
  /** Sets whether the graphic comes on with the scene; absent for someone who may not change the scene. */
  onComesOn?: (comesOn: boolean) => void;
}) {
  const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
  const text = describeGraphicSwitch(element, placement);
  const by = LIVE_OVERLAY_ELEMENT_SWITCHES[element];
  if (by !== "room")
    return (
      <span class="pk-scenes__switch" role="img" aria-label={`${label}: ${text}`} title={text}>
        {by === "pick" ? <PickIcon /> : <IconBolt />}
      </span>
    );
  const current = layoutSwitchChoice(placement);
  const other = LAYOUT_SWITCH_CHOICES.find((choice) => choice !== current)!;
  if (!onComesOn)
    return (
      <span
        class="pk-scenes__switch"
        role="img"
        aria-label={`${label}: ${text}`}
        title={`${text}\n${current.help}`}
        data-on={current.comesOn ? "" : undefined}
      >
        <IconBolt />
      </span>
    );
  return (
    <span class="pk-scenes__switch" data-on={current.comesOn ? "" : undefined}>
      <Button
        icon
        variant="ghost"
        aria-pressed={current.comesOn}
        aria-label={`${label}: ${LAYOUT_SWITCH_CHOICES[0].label}`}
        title={`${text}\n${current.help}\nClick: ${other.label.toLowerCase()}.`}
        disabled={disabled}
        onClick={() => onComesOn(!current.comesOn)}
      >
        <IconBolt />
      </Button>
    </span>
  );
}
