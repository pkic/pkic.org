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

import type { ComponentChildren } from "preact";
import { overflowClass, TabOverflowMenu, useTabOverflow } from "./TabOverflow";
import { Badge } from "./Badge";

import "./Tabs.css";

export interface TabListItem {
  readonly id: string;
  readonly label: ComponentChildren;
  /** The id of the panel this tab controls, so the two are linked. */
  readonly panelId?: string;
  /**
   * Names why the hidden panel needs the reader, e.g. a field there was
   * refused. Shown as a danger badge so a problem behind an unselected tab
   * is still discoverable, and announced as part of the tab's name.
   */
  readonly attention?: string;
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
  const { listRef, moreRef, fitting } = useTabOverflow(items.length);
  const selectedFits = items.findIndex((item) => item.id === activeId) < fitting;
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
    // A tab that did not fit is reached through the menu, which now carries its label.
    const target =
      nextIndex < fitting
        ? listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]
        : moreRef.current?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
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
    <div class={classes}>
      <div ref={listRef} class="pk-tabs__list" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-${item.id}` : undefined}
              class={overflowClass(index, fitting)}
              aria-selected={selected ? "true" : "false"}
              aria-controls={item.panelId}
              // Exactly one tab is in the tab order; the arrows move within.
              // Tabbing into the set lands on the selected tab, and tabbing
              // again leaves for the panel rather than the next tab.
              // When the selected tab is in the More menu, the first tab keeps the strip reachable.
              tabIndex={(selectedFits ? selected : index === 0) ? 0 : -1}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.label}
              {item.attention && <Badge tone="danger" label={item.attention} />}
            </button>
          );
        })}
      </div>
      <TabOverflowMenu
        entries={items.map((item, index) => ({
          id: item.id,
          label: typeof item.label === "string" ? item.label : textOf(listRef.current?.children[index]),
          attention: item.attention,
          onSelect: () => onSelect(item.id),
        }))}
        fitting={fitting}
        activeId={activeId}
        moreRef={moreRef}
        onArrowBack={() => move(fitting - 1)}
      />
    </div>
  );
}

/** A tab label with marks reads as its text in the menu; the attention badge travels separately. */
function textOf(tab: Element | undefined): string {
  if (!tab) return "";
  const copy = tab.cloneNode(true) as Element;
  for (const badge of copy.querySelectorAll(".pk-badge")) badge.remove();
  return copy.textContent?.trim() ?? "";
}
