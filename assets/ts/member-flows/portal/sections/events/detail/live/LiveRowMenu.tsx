import {
  LIVE_AUX_OUTPUT_DETAILS,
  LIVE_STUDIO_AUX_OUTPUTS,
  type LiveAuxOutput,
} from "../../../../../../../shared/live-room-outputs";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import { liveLayerTargets, sendLayerToggle, type LiveLayer, type LiveTargets } from "./live-output-targets";
import "./live-tally.css";
import "./LiveRowMenu.css";

/** The room's screens a graphic is on now. */
export function liveScreensOn(targets: LiveTargets, layer: LiveLayer): LiveAuxOutput[] {
  const where = liveLayerTargets(targets, layer);
  return LIVE_STUDIO_AUX_OUTPUTS.filter((output) => where.aux(output));
}

/** A switch per screen of the room, checked where the graphic is now. */
export function liveScreenItems(targets: LiveTargets, layer: LiveLayer): MenuItem[] {
  const on = liveScreensOn(targets, layer);
  return LIVE_STUDIO_AUX_OUTPUTS.map((output) => ({
    id: `screen-${output}`,
    label: LIVE_AUX_OUTPUT_DETAILS[output].label,
    checked: on.includes(output),
    multiple: true,
    keepOpen: true,
    disabled: targets.disabled,
    onSelect: () => sendLayerToggle(targets, layer, output),
  }));
}

/** The screens first, then the row's own actions after a separator. */
export function withScreenItems(screens: readonly MenuItem[], items: readonly MenuItem[]): MenuItem[] {
  return [...screens, ...items.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))];
}

/** The trigger's tooltip: the screens the graphic is on, or none. */
export function liveScreensTitle(on: readonly LiveAuxOutput[]): string | undefined {
  return on.length ? `On ${on.map((output) => LIVE_AUX_OUTPUT_DETAILS[output].label).join(" and ")}` : undefined;
}

/** A row menu's trigger: the ⋯, with a dot under it in each screen's color for every screen the graphic is on. */
export function LiveScreenTrigger({ on }: { on: readonly LiveAuxOutput[] }) {
  return (
    <>
      <span aria-hidden="true">⋯</span>
      {on.length ? (
        <span class="pk-live-screen-dots" aria-hidden="true">
          {on.map((output) => (
            <span key={output} data-tally={output} />
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * A studio row's menu for a graphic: the room's screens as switches at the
 * top, so a row keeps only PVW and PGM in line, then the row's own actions.
 * The trigger carries a dot for each screen the graphic is on.
 */
export function LiveRowMenu({
  targets,
  layer,
  label,
  heading,
  items = [],
}: {
  targets: LiveTargets;
  layer: LiveLayer;
  label: string;
  heading?: string;
  items?: readonly MenuItem[];
}) {
  const on = liveScreensOn(targets, layer);
  return (
    <Menu
      label={label}
      heading={heading}
      align="end"
      title={liveScreensTitle(on)}
      items={withScreenItems(liveScreenItems(targets, layer), items)}
    >
      <LiveScreenTrigger on={on} />
    </Menu>
  );
}
