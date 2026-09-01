/**
 * Locating a tab in an end-to-end spec, when there are two legitimate kinds.
 *
 * A tab that NAVIGATES is a link marked `aria-current="page"` — its position
 * is a URL, so it can be shared, bookmarked and opened in a new tab. A tab
 * that SWITCHES A PANEL already on the page is a button with `role="tab"`.
 * The portal has both, and which one a surface uses is a real decision about
 * whether that tab is a place.
 *
 * Specs used to reach for `getByRole("tab")` everywhere, because everything
 * rendered as a link carrying `role="tab"` — markup that promised a screen
 * reader arrow-key movement between panels and then navigated instead. Going
 * through here keeps a spec asking for "the Reviews tab" rather than for the
 * element type that happens to implement it today.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/** The tab named `name`, of either kind, within `scope`. */
export function tab(scope: Page | Locator, name: string | RegExp): Locator {
  return scope.getByRole("tab", { name }).or(scope.locator("a.pk-tabs__link").filter({ hasText: name }));
}

/** Asserts that the named tab is the one currently showing. */
export async function expectCurrentTab(scope: Page | Locator, name: string | RegExp): Promise<void> {
  const located = tab(scope, name);
  await expect(located).toBeVisible();
  const current = await located.evaluate(
    (element) => element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-current") === "page",
  );
  expect(current, `expected the ${String(name)} tab to be the current one`).toBe(true);
}
