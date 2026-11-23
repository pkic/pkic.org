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

/**
 * The tab named `name`, of either kind, within `scope`, as the strip shows it:
 * a tab that did not fit is in the strip's More menu, and while it is the
 * current one the menu button carries its label.
 */
export function tab(scope: Page | Locator, name: string | RegExp): Locator {
  return scope
    .getByRole("tab", { name })
    .or(scope.locator("a.pk-tabs__link").filter({ hasText: name, visible: true }))
    .or(scope.locator(".pk-tabs__more button").filter({ hasText: name }));
}

/** Opens the named tab, through the strip's More menu when it did not fit. */
export async function openTab(scope: Page | Locator, name: string | RegExp): Promise<void> {
  const shown = tab(scope, name);
  const more = scope.locator(".pk-tabs__more button");
  // A strip may still be rendering, so the tab is looked for again until it shows up in one place or the other.
  await expect(async () => {
    if (await shown.isVisible()) return shown.click();
    for (const button of await more.all()) {
      await button.click();
      const item = scope.getByRole("menuitemradio", { name }).or(scope.getByRole("menuitem", { name }));
      if (await item.isVisible()) return item.click();
      await button.press("Escape");
    }
    throw new Error(`No ${String(name)} tab, in a strip or its More menu`);
  }).toPass({ timeout: 15_000 });
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
