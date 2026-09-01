/**
 * The design system on a real screen.
 *
 * Every other gate in this repository reads source. None of them can see a
 * panel that pushes the page sideways on a phone, a control that vanishes
 * against its own background in dark mode, or a stylesheet that failed to
 * load. This renders the whole primitive library at three widths, in both
 * themes, at both densities, and looks.
 *
 * `/design/` is the right page for it: it is framework-free — it loads no
 * Bootstrap at all — so anything wrong here is the design system's own doing
 * and not something Bootstrap was quietly propping up.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const WIDTHS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

/** How far the page can be scrolled sideways. Anything above zero is a bug. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(0, root.scrollWidth - root.clientWidth);
  });
}

/**
 * Every element that pushes the PAGE sideways, named well enough to find it.
 *
 * Being wider than the viewport is not by itself a fault: a wide table inside
 * `overflow-x: auto` is exactly how a table survives a phone, and a scrolling
 * section nav is a deliberate design. What matters is whether anything CLIPS
 * it before it reaches the document, so an element is reported only when
 * nothing between it and the root scrolls.
 */
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
      // Only report the outermost offender in a chain, or every nested child
      // of one wide element is listed too.
      if (element.parentElement && element.parentElement.getBoundingClientRect().right > limit + 1) continue;
      const name = element.className || "(no class)";
      const text = (element.textContent ?? "").trim().slice(0, 40);
      guilty.push(`${element.tagName.toLowerCase()}.${name} -> ${Math.round(rect.right)}px "${text}"`);
    }
    return guilty;
  });
}

async function openPreview(page: Page): Promise<void> {
  await page.goto("/design/");
  await expect(page.locator("main.pk-preview__main")).toBeVisible();
  // The preview is rendered by a lazy chunk; wait for a primitive to exist
  // rather than for a timeout.
  await expect(page.locator(".pk-btn").first()).toBeVisible();
}

test.describe("design system rendering", () => {
  test("loads without Bootstrap and without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await openPreview(page);

    // The page's own claim: it is framework-free. Counting Bootstrap's rules
    // in the loaded stylesheets is the only way to hold it to that.
    const bootstrapRules = await page.evaluate(() => {
      let count = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // Cross-origin sheet; none of ours are.
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && /\.(btn|card|badge|form-control|row|col-)\b/.test(rule.selectorText)) {
            count += 1;
          }
        }
      }
      return count;
    });

    expect(bootstrapRules).toBe(0);
    expect(errors).toEqual([]);
  });

  for (const viewport of WIDTHS) {
    test(`fits the viewport at ${viewport.name} (${String(viewport.width)}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPreview(page);

      const offenders = await overflowingElements(page);
      expect(offenders, `elements wider than the viewport at ${viewport.name}`).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);

      await page.screenshot({
        path: `test-results/design-system-${viewport.name}-light.png`,
        fullPage: true,
      });
    });

    test(`fits the viewport at ${viewport.name} in dark mode`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPreview(page);
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

      expect(await horizontalOverflow(page)).toBe(0);

      // A theme that fails to swap leaves dark text on a dark ground. Reading
      // the computed values is the only way to catch a token defined only
      // inside a media query.
      const ground = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          surface: style.getPropertyValue("--pk-surface").trim(),
          ink: style.getPropertyValue("--pk-ink").trim(),
        };
      });
      expect(ground.surface).not.toBe("");
      expect(ground.ink).not.toBe("");
      expect(ground.surface).not.toBe(ground.ink);

      await page.screenshot({
        path: `test-results/design-system-${viewport.name}-dark.png`,
        fullPage: true,
      });
    });
  }

  test("stays within the viewport at compact density, where things are tightest", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPreview(page);
    await page.evaluate(() => document.documentElement.setAttribute("data-density", "compact"));
    expect(await horizontalOverflow(page)).toBe(0);
  });

  /*
   * A variant that resolves to nothing.
   *
   * Several primitives emit a modifier class only for their NON-default
   * variants, so the default carries the base class alone. If the base class
   * reads a custom property that only the modifiers define, the declaration
   * is invalid and the element falls back to `auto` — which for an avatar in
   * a stretching column meant a 300-pixel circle on every page that used the
   * default size. Nothing in the source says so; only a laid-out page does.
   */
  test("gives every fixed-size primitive a real size at its default variant", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openPreview(page);

    const oversized = await page.evaluate(() => {
      const limits: Record<string, number> = {
        ".pk-avatar": 64,
        ".pk-spinner__circle": 64,
        ".pk-badge": 320,
        ".pk-chip": 320,
      };
      const found: string[] = [];
      for (const [selector, max] of Object.entries(limits)) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          const rect = element.getBoundingClientRect();
          if (rect.width > max || rect.height > max) {
            found.push(`${selector} → ${Math.round(rect.width)}×${Math.round(rect.height)} (max ${String(max)})`);
          }
        }
      }
      return found;
    });

    expect(oversized).toEqual([]);
  });

  test("keeps every interactive control reachable by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPreview(page);

    // Anything that looks operable must be operable. A div with an onClick
    // passes every source-level check and strands a keyboard user.
    const unreachable = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("[onclick]")) {
        const tag = element.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || element.tabIndex >= 0) continue;
        found.push(`${tag}.${element.className}`);
      }
      return found;
    });
    expect(unreachable).toEqual([]);
  });
});
