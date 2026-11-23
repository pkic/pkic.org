/**
 * The More menu every tab strip ends with once its tabs do not fit.
 *
 * Tabs that do not fit are not scrolled to: a strip that scrolls gives a mouse
 * no way across, and whether its last tab shows as cut off depends on the
 * labels. So the strip shows the tabs that fit and puts the rest in a menu at
 * its end, at every width. When the current tab is one of those, the menu
 * button carries its label and the current-tab mark, so the strip always says
 * where the reader is.
 *
 * The tabs that do not fit stay in the strip, invisible, so they keep their
 * width and every measurement is a plain read of the layout.
 */

import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { Badge } from "./Badge";
import { Menu, type MenuItem } from "./Menu";

/** A tab is out of the strip once its end passes the room left beside the menu. */
function countFitting(list: HTMLElement, more: HTMLElement | null): number {
  const tabs = [...list.children].filter((child) => child.classList.contains("pk-tabs__link"));
  const bounds = list.getBoundingClientRect();
  if (bounds.width === 0) return tabs.length;
  const fits = (end: number) => tabs.every((tab) => tab.getBoundingClientRect().right <= end + 0.5);
  if (fits(bounds.right)) return tabs.length;
  // The gap between tabs also separates the last tab that fits from the menu button.
  const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
  const end = bounds.right - (more?.offsetWidth ?? 0) - gap;
  const index = tabs.findIndex((tab) => tab.getBoundingClientRect().right > end + 0.5);
  return Math.max(index, 0);
}

/** A tab label with marks reads as its text in the menu; the attention badge travels separately. */
function textOf(tab: Element): string {
  const copy = tab.cloneNode(true) as Element;
  for (const badge of copy.querySelectorAll(".pk-badge")) badge.remove();
  return copy.textContent?.trim() ?? "";
}

/** What the menu repeats of a rendered tab: its plain text and, for a link, where it leads. */
export interface RenderedTab {
  readonly text: string;
  readonly href: string | null;
}

function readTabs(list: HTMLElement): string {
  const tabs = [...list.children].filter((child) => child.classList.contains("pk-tabs__link"));
  return JSON.stringify(tabs.map((tab): RenderedTab => ({ text: textOf(tab), href: tab.getAttribute("href") })));
}

/**
 * Measures how many tabs fit; the strip renders the rest invisibly and lists them in its menu.
 * It also reads each tab as rendered, after the render, so the menu never repeats a previous label or link.
 */
export function useTabOverflow(itemCount: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [fitting, setFitting] = useState(itemCount);
  const [rendered, setRendered] = useState("[]");
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      setFitting(countFitting(list, moreRef.current));
      setRendered(readTabs(list));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The strip resizes with the page; a tab resizes when its label or the font changes.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const tab of list.children) observer.observe(tab);
    if (moreRef.current) observer.observe(moreRef.current);
    return () => observer.disconnect();
  });
  const tabs = useMemo(() => JSON.parse(rendered) as RenderedTab[], [rendered]);
  return { listRef, moreRef, fitting: Math.min(fitting, itemCount), tabs };
}

export interface TabOverflowEntry {
  readonly id: string;
  /** Plain text: the menu cannot carry a tab's marks. */
  readonly label: string;
  /** The tab's small mark before its label, such as a location that is not streamed, kept in the menu. */
  readonly icon?: ComponentChildren;
  /** What the mark means, as the entry's tooltip. */
  readonly title?: string;
  readonly href?: string;
  readonly onSelect?: () => void;
  /** Why a hidden tab needs the reader; carried onto the menu button so it is not lost. */
  readonly attention?: string;
}

export interface TabOverflowMenuProps {
  /** Every tab of the strip, in order. */
  entries: ReadonlyArray<TabOverflowEntry>;
  fitting: number;
  activeId: string;
  moreRef: { current: HTMLDivElement | null };
  /** Left arrow on the menu button, for a tab list whose arrows move between tabs. */
  onArrowBack?: () => void;
}

export function TabOverflowMenu({ entries, fitting, activeId, moreRef, onArrowBack }: TabOverflowMenuProps) {
  const hidden = entries.slice(fitting);
  if (hidden.length === 0) return null;
  const current = hidden.find((entry) => entry.id === activeId);
  const items: MenuItem[] = hidden.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: entry.icon,
    tooltip: entry.title,
    href: entry.href,
    onSelect: entry.onSelect,
    description: entry.attention,
    checked: entry.id === activeId,
  }));
  const attention = hidden.find((entry) => entry.attention)?.attention;
  return (
    <div
      class="pk-tabs__more"
      ref={moreRef}
      onKeyDown={(event) => {
        // Only from the button itself: inside the open menu, Left belongs to the menu.
        const onButton = event.target instanceof Element && event.target.classList.contains("pk-menu__trigger");
        if (!onArrowBack || !onButton || event.key !== "ArrowLeft") return;
        event.preventDefault();
        onArrowBack();
      }}
    >
      <Menu
        label={[current ? `${current.label}, more tabs` : "More tabs", attention].filter(Boolean).join(", ")}
        items={items}
        align="end"
        variant="plain"
        triggerClass={["pk-tabs__link", current ? "pk-tabs__link--current" : null].filter(Boolean).join(" ")}
      >
        {current?.icon}
        {current?.label ?? "More"}
        <span class="pk-tabs__chevron" aria-hidden="true" />
        {attention && <Badge tone="danger" label={attention} />}
      </Menu>
    </div>
  );
}

/** A tab that does not fit keeps its place, but is neither seen, read out nor focused. */
export function overflowClass(index: number, fitting: number): string {
  return `pk-tabs__link ${index < fitting ? "" : "pk-tabs__link--overflow"}`.trim();
}
