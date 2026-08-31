/**
 * Tabs — navigation between views as real links.
 *
 * Each tab is a link that navigates; the active one has aria-current="page".
 * This is NOT an ARIA tab component: it does not use role="tab" or "tablist",
 * which imply scripted panel switching and keyboard arrow semantics.
 */

import "./Tabs.css";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  label: string;
  class?: string;
}

export function Tabs({ items, activeId, label, class: className }: TabsProps) {
  const classes = ["pk-tabs", className].filter(Boolean).join(" ");

  return (
    <nav class={classes} aria-label={label}>
      <div class="pk-tabs__list">
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            class="pk-tabs__link"
            aria-current={item.id === activeId ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
