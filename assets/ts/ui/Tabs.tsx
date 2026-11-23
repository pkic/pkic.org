/**
 * Tabs — navigation between views as real links.
 *
 * Each tab is a link that navigates; the active one has aria-current="page".
 * This is NOT an ARIA tab component: it does not use role="tab" or "tablist",
 * which imply scripted panel switching and keyboard arrow semantics.
 */

import type { ComponentChildren } from "preact";
import "./Tabs.css";
import { useActiveTabVisibility } from "./useActiveTabVisibility";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** A small mark before the label for a tab that differs from the rest, such as a location that is not streamed. */
  readonly icon?: ComponentChildren;
  /** What the mark means, as the tab's tooltip. */
  readonly title?: string;
}

export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  label: string;
  class?: string;
}

export function Tabs({ items, activeId, label, class: className }: TabsProps) {
  const listRef = useActiveTabVisibility(activeId);
  const classes = ["pk-tabs", className].filter(Boolean).join(" ");

  return (
    <nav class={classes} aria-label={label}>
      <div class="pk-tabs__list" ref={listRef}>
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            class="pk-tabs__link"
            aria-current={item.id === activeId ? "page" : undefined}
            title={item.title}
          >
            {item.icon}
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
