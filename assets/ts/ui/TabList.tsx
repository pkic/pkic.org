/**
 * TabList — switching between panels that are already on the page.
 *
 * The sibling of `Tabs`, and deliberately a separate component rather than a
 * mode of it, because the two make different promises. `Tabs` is navigation:
 * each tab is a link to a URL, and the current one says `aria-current="page"`.
 * This one is the WAI-ARIA tab pattern: nothing navigates, a script swaps the
 * panel, and the contract that comes with `role="tab"` is a real one —
 * exactly one tab in the tab order, arrows to move between them, and the
 * selected tab pointing at the panel it controls.
 *
 * Collapsing them into one component would mean a link carrying `role="tab"`,
 * which is what the version this replaces did: it announced itself as a tab
 * while behaving as a link, so a screen reader promised arrow-key movement
 * that the browser then handled as navigation.
 */

import { useRef } from "preact/hooks";

import "./Tabs.css";

export interface TabListItem {
  readonly id: string;
  readonly label: string;
  /** The id of the panel this tab controls, so the two are linked. */
  readonly panelId?: string;
}

export interface TabListProps {
  items: ReadonlyArray<TabListItem>;
  activeId: string;
  onSelect: (id: string) => void;
  /** Names the set, e.g. "Proposal sections". */
  label: string;
  /** Prefix for each tab's own id, so a panel can point back at its tab. */
  idPrefix?: string;
  class?: string;
}

export function TabList({ items, activeId, onSelect, label, idPrefix, class: className }: TabListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const classes = ["pk-tabs", className].filter(Boolean).join(" ");

  /**
   * Moves selection AND focus together, which is what the pattern calls for:
   * an arrow key on a tab list selects as it moves, so a keyboard user sees
   * the same thing a mouse user does without a second keystroke.
   */
  function move(nextIndex: number) {
    const next = items[nextIndex];
    if (!next) return;
    onSelect(next.id);
    const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[nextIndex]?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        move(index === 0 ? last : index - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        move(index === last ? 0 : index + 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(last);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={listRef} class={classes}>
      <div class="pk-tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-${item.id}` : undefined}
              class="pk-tabs__link"
              aria-selected={selected ? "true" : "false"}
              aria-controls={item.panelId}
              // Exactly one tab is in the tab order; the arrows move within.
              // Tabbing into the set lands on the selected tab, and tabbing
              // again leaves for the panel rather than the next tab.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
