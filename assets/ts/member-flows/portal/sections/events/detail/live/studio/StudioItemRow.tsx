import type { ComponentChildren } from "preact";
import "./StudioItemRow.css";

/**
 * One item of a studio list in one compact row: its text, which opens it, a
 * summary line under it, its actions and its menu. The text gives way first;
 * a narrow panel puts the actions under it. Polls and questions share it.
 */
export function StudioItemRow({
  text,
  open,
  summary,
  actions,
  menu,
  presenceItem,
}: {
  text: string;
  /** What opening the item does, and its name for the tooltip. */
  open: { title: string; onOpen: () => void };
  summary: ComponentChildren;
  actions?: ComponentChildren;
  /** The row's menu, which holds every action. */
  menu: ComponentChildren;
  presenceItem?: string;
}) {
  return (
    <li class="pk-studio-row" data-presence-item={presenceItem}>
      <button type="button" class="pk-studio-row__open" title={open.title} onClick={open.onOpen}>
        <span class="pk-studio-row__text">{text}</span>
        <span class="pk-studio-row__summary">{summary}</span>
      </button>
      {actions ? <span class="pk-studio-row__actions">{actions}</span> : null}
      {menu}
    </li>
  );
}
