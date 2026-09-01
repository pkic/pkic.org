/**
 * The portal's tab strip, resolved to whichever design-system component the
 * caller actually meant.
 *
 * Callers pass `hrefFor` when a tab is a place — a URL that should be
 * shareable and survive the back button — and omit it when a tab merely
 * swaps a panel already on the page. Those are two different accessibility
 * contracts, and the version this replaces gave both the same markup: a
 * wouter `<Link role="tab">`. A link that claims to be a tab announces
 * arrow-key movement between panels and then navigates instead.
 *
 * So the choice the caller already makes now picks the right component:
 * `Tabs` (links, `aria-current="page"`) or `TabList` (buttons, `role="tab"`,
 * arrow keys, `aria-controls`).
 */
import { Link } from "wouter";

import { TabList } from "../ui/TabList";
// The navigating variant is rendered here rather than by `ui/Tabs` because it
// has to be a wouter <Link>: the portal is hash-routed, and a plain <a href>
// would navigate away from the app instead of within it. The design system
// cannot know that, so it supplies the appearance and this supplies the link.
import "../ui/Tabs.css";

export interface TabItem {
  key: string;
  label: string;
  panelId?: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
  idPrefix?: string;
  /** Names the set for assistive technology. */
  label?: string;
  /**
   * When set, tabs are real links to `hrefFor(key)`, so a tab position is
   * shareable and back-button safe.
   */
  hrefFor?: (key: string) => string;
}

export function Tabs({ items, active, onChange, className, idPrefix, label = "Sections", hrefFor }: TabsProps) {
  if (hrefFor) {
    return (
      <nav class={["pk-tabs", className].filter(Boolean).join(" ")} aria-label={label}>
        <div class="pk-tabs__list">
          {items.map((item) => (
            <Link
              key={item.key}
              href={hrefFor(item.key)}
              class="pk-tabs__link"
              aria-current={item.key === active ? "page" : undefined}
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <TabList
      class={className}
      label={label}
      idPrefix={idPrefix}
      activeId={active}
      onSelect={onChange}
      items={items.map((item) => ({ id: item.key, label: item.label, panelId: item.panelId }))}
    />
  );
}
