/**
 * Finding tabs in a test, when there are two legitimate kinds.
 *
 * A tab that NAVIGATES is a link marked `aria-current="page"`. A tab that
 * SWITCHES A PANEL already on the page is a button marked `role="tab"` and
 * `aria-selected`. Both are correct; which one a surface uses depends on
 * whether the tab is a place.
 *
 * These suites used to select `[role="tab"]` for both, because both were
 * rendered as links carrying `role="tab"` — markup that promised arrow-key
 * movement between panels and then navigated instead. Selecting through here
 * keeps a test asserting "the Reviews tab is the current one" rather than
 * "the Reviews tab is a button with aria-selected", which is not the point.
 */

/** Every tab on the page, of either kind, in document order. */
export function tabs(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="tab"], .pk-tabs__link')];
}

/** The tab whose visible text contains `label`. */
export function tabNamed(root: ParentNode, label: string): HTMLElement | undefined {
  return tabs(root).find((tab) => tab.textContent?.includes(label));
}

/** Whether this tab is the one currently showing. */
export function isCurrentTab(tab: Element | null | undefined): boolean {
  if (!tab) return false;
  return tab.getAttribute("aria-selected") === "true" || tab.getAttribute("aria-current") === "page";
}

/** The visible text of every tab, in order. */
export function tabNames(root: ParentNode): string[] {
  return tabs(root).map((tab) => tab.textContent?.trim() ?? "");
}
