/**
 * The portal on a phone, a tablet and a desktop.
 *
 * The design-system preview proves the primitives behave. This proves the
 * screens built from them do — which is a different question, because a screen
 * is where a wide table meets a narrow column meets a sidebar that has to get
 * out of the way.
 *
 * Three things are checked on every screen at every width, and each of them is
 * a defect this repository has actually shipped:
 *
 *   - Nothing pushes the page sideways. A single unclipped element does it,
 *     and once it happens every screen on the site scrolls horizontally.
 *   - Nothing is operable by mouse only. An onClick on a div, a span or a
 *     table row type-checks, lints, renders, and strands anyone using a
 *     keyboard. Fourteen portal lists were built that way.
 *   - Every table has a name, every icon-only control has a name, and every
 *     form control resolves to a label. An unnamed control is invisible to
 *     anyone who is not looking at it.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/** The portal screens that are migrated and worth holding to this standard. */
const SCREENS = [
  { name: "home", path: "#/" },
  { name: "profile", path: "#/profile" },
  { name: "account", path: "#/account" },
  { name: "groups", path: "#/groups" },
  { name: "organizations", path: "#/organizations" },
] as const;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/** Elements that push the page sideways, skipping anything a scroller clips. */
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

/** Anything that responds to a click but cannot be focused or activated. */
async function mouseOnlyControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("[onclick]")) {
      const tag = element.tagName.toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "select" || tag === "textarea") continue;
      if (element.tabIndex >= 0) continue;
      found.push(`${tag}.${element.className || "(none)"}`);
    }
    return found;
  });
}

/** Controls and regions with nothing to announce them by. */
async function unnamedThings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];

    function named(element: HTMLElement): boolean {
      if (element.getAttribute("aria-label")?.trim()) return true;
      if (element.getAttribute("aria-labelledby")) return true;
      if (element.getAttribute("title")?.trim()) return true;
      if ((element.textContent ?? "").trim()) return true;
      // A link or button whose whole content is an image takes its name from
      // that image's alt text, and an inline SVG from its <title>.
      for (const image of element.querySelectorAll("img[alt]")) {
        if ((image.getAttribute("alt") ?? "").trim()) return true;
      }
      if (element.querySelector("svg > title")?.textContent?.trim()) return true;
      const id = element.getAttribute("id");
      if (id && document.querySelector(`label[for="${id}"]`)) return true;
      return Boolean(element.closest("label"));
    }

    for (const table of document.querySelectorAll("table")) {
      const caption = table.querySelector("caption")?.textContent?.trim();
      if (!caption && !table.getAttribute("aria-label") && !table.getAttribute("aria-labelledby")) {
        problems.push(`table with no name: ${table.className || "(none)"}`);
      }
    }

    for (const control of document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")) {
      if (control.getAttribute("aria-hidden") === "true") continue;
      if (control instanceof HTMLInputElement && control.type === "hidden") continue;
      if (!named(control)) {
        problems.push(`${control.tagName.toLowerCase()} with no name: ${control.className || "(none)"}`);
      }
    }

    return problems;
  });
}

/*
 * One sign-in, every width.
 *
 * Each sign-in issues a magic link and redeems it, and the portal rate-limits
 * that per client address. Four tests that each sign in as the same operator
 * exhaust the limiter and the later ones never get a session — so this walks
 * all three widths inside one test rather than paying for three sessions to
 * assert the same thing.
 */
test.describe("portal at every width", () => {
  test("is usable at mobile, tablet and desktop", async ({ page }) => {
    await signInAsE2eStaff(page, e2eAdminEmail());

    const failures: string[] = [];

    for (const viewport of WIDTHS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const screen of SCREENS) {
        await page.goto(`/portal/${screen.path}`);
        await expect(page.locator("#portal-root")).toBeVisible();
        // The section renders into a lazy chunk; wait for content, not a timer.
        await page.waitForLoadState("networkidle");

        const where = `${viewport.name}/${screen.name}`;
        for (const problem of await overflowingElements(page)) {
          failures.push(`${where}: overflows — ${problem}`);
        }
        const overflow = await horizontalOverflow(page);
        if (overflow > 0) failures.push(`${where}: page scrolls ${String(overflow)}px sideways`);

        for (const problem of await mouseOnlyControls(page)) {
          failures.push(`${where}: mouse-only control — ${problem}`);
        }
        for (const problem of await unnamedThings(page)) {
          failures.push(`${where}: ${problem}`);
        }

        await page.screenshot({
          path: `test-results/portal-${screen.name}-${viewport.name}.png`,
          fullPage: true,
        });
      }
    }

    expect(failures, "portal problems across widths").toEqual([]);
  });

  test("opens and closes its navigation on a phone, and returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAsE2eStaff(page, e2eAdminEmail());

    const toggle = page.locator("#portal-sidebar-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#portal-sidebar")).toHaveClass(/open/);

    // Escape closes it and puts focus back on the control that opened it,
    // rather than leaving a keyboard user somewhere behind the panel.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  });
});
