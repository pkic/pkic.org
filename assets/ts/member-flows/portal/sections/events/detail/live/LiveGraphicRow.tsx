import type { ComponentChildren } from "preact";
import { Menu, type MenuItem } from "../../../../../../ui/Menu";
import { LiveLayerTargets } from "./LiveLayerTargets";
import { LiveRowMenu } from "./LiveRowMenu";
import type { LiveLayer, LiveTargets } from "./live-output-targets";
import "./LiveGraphicRow.css";

/**
 * One graphic in the Graphics panel, like a timer's row: its name, what it
 * shows now, PVW and PGM, and the row's menu with the room's screens and
 * its settings.
 */
export function LiveGraphicRow({
  name,
  detail,
  outputs,
  settings,
  children,
}: {
  name: string;
  detail: string;
  /** Where the graphic goes; a graphic with nothing to show yet has none. */
  outputs?: { targets: LiveTargets; layer: LiveLayer; subject: string };
  settings?: { label: string; onOpen: () => void; disabled?: boolean };
  children?: ComponentChildren;
}) {
  const items: MenuItem[] = settings
    ? [{ id: "settings", label: settings.label, disabled: settings.disabled, onSelect: settings.onOpen }]
    : [];
  return (
    <div class="pk-live-graphic-row" role="group" aria-label={`${name} controls`}>
      <div class="pk-live-graphic-row__name">
        <strong>{name}</strong>
        <span class="pk-live-graphic-row__detail" title={detail}>
          {detail}
        </span>
      </div>
      {outputs ? <LiveLayerTargets targets={outputs.targets} subject={outputs.subject} layer={outputs.layer} /> : null}
      {children}
      {outputs ? (
        <LiveRowMenu
          targets={outputs.targets}
          layer={outputs.layer}
          label={`${name} actions`}
          heading={name}
          items={items}
        />
      ) : items.length ? (
        <Menu label={`${name} actions`} heading={name} align="end" items={items} />
      ) : null}
    </div>
  );
}
