import type { ComponentChildren } from "preact";
import { Menu } from "../../../../../../ui/Menu";
import "./LiveGraphicRow.css";

/**
 * One graphic in the Graphics panel, like a timer's row: its name, what it
 * shows now, where it goes, and its settings in the row's menu.
 */
export function LiveGraphicRow({
  name,
  detail,
  settings,
  children,
}: {
  name: string;
  detail: string;
  settings?: { label: string; onOpen: () => void; disabled?: boolean };
  children: ComponentChildren;
}) {
  return (
    <div class="pk-live-graphic-row" role="group" aria-label={`${name} controls`}>
      <div class="pk-live-graphic-row__name">
        <strong>{name}</strong>
        <span class="pk-live-graphic-row__detail" title={detail}>
          {detail}
        </span>
      </div>
      {children}
      {settings ? (
        <Menu
          label={`${name} actions`}
          heading={name}
          align="end"
          items={[{ id: "settings", label: settings.label, disabled: settings.disabled, onSelect: settings.onOpen }]}
        />
      ) : (
        // Holds the menu's place, so a row without one keeps its outputs in line with the rest.
        <span class="pk-live-graphic-row__menu-slot" aria-hidden="true" />
      )}
    </div>
  );
}
