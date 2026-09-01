/**
 * The public site on a phone, a tablet and a desktop.
 *
 * The design-system spec proves the primitives behave and the portal spec
 * proves the authenticated screens do. This covers everything a visitor sees
 * without signing in — which is most of the site, and the part where a layout
 * fault is seen by the most people.
 *
 * It exists because the footer taught the lesson: a single Bootstrap row whose
 * negative margins exceeded its container made EVERY page on the site scroll
 * sideways on a phone, and nothing that reads source could see it.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/**
 * One page per distinct layout, not one per URL. The site has hundreds of
 * pages and a handful of shapes; walking the shapes is what finds faults.
 */
const PAGES = [
  { name: "home", path: "/" },
  { name: "events", path: "/events/" },
  { name: "members", path: "/members/" },
  { name: "working-groups", path: "/wg/" },
  { name: "blog", path: "/blog/" },
  { name: "join", path: "/join/" },
  { name: "donate", path: "/donate/" },
  { name: "about", path: "/about/" },
] as const;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/** Elements that push the page sideways, ignoring anything a scroller clips. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const guilty: string[] = [];

    function clipped(element: HTMLElement): boolean {
      let parent = element.parentElement;
      while (parent && parent !== document.documentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
        parent = parent.parentElement;
      }
      return false;
    }

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= limit + 1) continue;
      if (clipped(element)) continue;
      if (element.parentElement && element.parentElement.getBoundingClientRect().right > limit + 1) continue;
      guilty.push(`${element.tagName.toLowerCase()}.${element.className || "(none)"} → ${Math.round(rect.right)}px`);
    }
    return guilty;
  });
}

/** Anything that answers a click but cannot be focused. */
async function mouseOnlyControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("[onclick]")) {
      const tag = element.tagName.toLowerCase();
      if (["button", "a", "input", "select", "textarea"].includes(tag)) continue;
      if (element.tabIndex >= 0) continue;
      found.push(`${tag}.${element.className || "(none)"}`);
    }
    return found;
  });
}

test.describe("public site at every width", () => {
  test("fits the viewport and stays operable at mobile, tablet and desktop", async ({ page }) => {
    const failures: string[] = [];

    for (const viewport of WIDTHS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const target of PAGES) {
        const response = await page.goto(target.path);
        // A 404 here means the fixture site does not build that page; skip it
        // rather than reporting a layout fault for a page that is not there.
        if (response && response.status() >= 400) continue;
        await page.waitForLoadState("domcontentloaded");

        const where = `${viewport.name}/${target.name}`;
        for (const problem of await overflowingElements(page)) {
          failures.push(`${where}: overflows — ${problem}`);
        }
        const overflow = await horizontalOverflow(page);
        if (overflow > 0) failures.push(`${where}: page scrolls ${String(overflow)}px sideways`);

        for (const problem of await mouseOnlyControls(page)) {
          failures.push(`${where}: mouse-only control — ${problem}`);
        }

        // Kept for the eye. The assertions above catch what can be measured;
        // these are what someone looks at to judge whether it reads well.
        await page.screenshot({
          path: `test-results/public-${target.name}-${viewport.name}.png`,
          fullPage: true,
        });
      }
    }

    expect(failures, "public site problems across widths").toEqual([]);
  });

  test("opens and closes the site navigation on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const toggle = page.locator(".pkic-navbar-toggler").first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Escape closes it, so a keyboard user is not trapped behind the panel.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
