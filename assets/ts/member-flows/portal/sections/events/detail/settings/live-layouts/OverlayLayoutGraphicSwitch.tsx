import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  liveOverlayElementFillsItself,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { Menu } from "../../../../../../../ui/Menu";
import { IconChevron } from "../../../../../../../ui/MediaIcons";
import { LAYOUT_SWITCH_CHOICES, describeGraphicSwitch, layoutSwitchChoice } from "./overlay-layout-copy";

/**
 * What puts a graphic on in this scene, under its name in the graphics list.
 * A graphic that fills itself from the room carries the scene's one choice:
 * it comes on with the scene, or it is switched in the studio. Every other
 * graphic says how it is switched instead, and has nothing to choose. Without
 * `onComesOn` the choice is only read.
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
  const text = describeGraphicSwitch(element, placement);
  if (!liveOverlayElementFillsItself(element)) return <span class="pk-scenes__switch">{text}</span>;
  const current = layoutSwitchChoice(placement);
  if (!onComesOn)
    return (
      <span class="pk-scenes__switch" title={`${text}\n${current.help}`}>
        {text}
      </span>
    );
  return (
    <span class="pk-scenes__switch">
      <Menu
        variant="plain"
        label={`${LIVE_OVERLAY_ELEMENT_LABELS[element]}: ${text}`}
        title={`${LIVE_OVERLAY_ELEMENT_LABELS[element]}: ${text}\n${current.help} Open to change it.`}
        triggerClass="pk-scenes__choice"
        disabled={disabled}
        items={LAYOUT_SWITCH_CHOICES.map((choice) => ({
          id: choice.comesOn ? "comes-on" : "studio",
          label: choice.label,
          description: choice.help,
          checked: choice === current,
          onSelect: () => onComesOn(choice.comesOn),
        }))}
      >
        {text}
        <IconChevron pointing="down" />
      </Menu>
    </span>
  );
}
