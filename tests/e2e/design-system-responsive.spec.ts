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
 * @covers presentation.13.2
 * @covers presentation.13.3
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
  // Scoped to the preview itself: the site chrome carries its own, hidden
  // `.pk-btn` (the search panel's close button) ahead of the specimens.
  await expect(page.locator("main.pk-preview__main .pk-btn").first()).toBeVisible();
}

test.describe("design system rendering", () => {
  test("loads without Bootstrap and without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      // The site's account menu asks every page for a session; an anonymous visitor's 401 is its answer, not a defect.
      const anonymousSessionProbe =
        message.location().url.endsWith("/api/v1/auth/session") && message.text().includes("401");
      if (message.type() === "error" && !anonymousSessionProbe) errors.push(message.text());
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

  for (const width of [1280, 375]) {
    test(`keeps each table row's pointer and keyboard destination at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/design/?only=data");
      const table = page.getByRole("table", { name: "Members and what can be done to them", exact: true });
      await expect(table).toBeVisible();
      const rows = table.locator("tbody tr");
      await expect(rows).toHaveCount(4);
      for (const row of await rows.all()) {
        await row.scrollIntoViewIfNeeded();
        const primary = row.getByRole("link", { name: /^Open / });
        await expect(primary).toHaveCount(1);
        const destination = await primary.getAttribute("href");
        const bounds = await row.evaluate((element) => {
          const row = element.getBoundingClientRect();
          return [...element.querySelectorAll(".pk-table__row-link")].map((link) => {
            const rect = link.getBoundingClientRect();
            return (
              !rect.width ||
              !rect.height ||
              (rect.top >= row.top - 1 &&
                rect.bottom <= row.bottom + 1 &&
                rect.left >= row.left - 1 &&
                rect.right <= row.right + 1)
            );
          });
        });
        expect(bounds.every(Boolean), "row targets must not cover other rows").toBe(true);
        const date = await row.locator("td").nth(2).boundingBox();
        expect(date).not.toBeNull();
        // A real coordinate click exposes overlapping links that locator.click can avoid.
        await page.mouse.click(date!.x + date!.width / 2, date!.y + date!.height / 2);
        await expect.poll(() => new URL(page.url()).hash).toBe(destination);
        await primary.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => new URL(page.url()).hash).toBe(destination);
      }
      if (width === 1280) {
        const target = rows.first().locator("td").nth(2).locator(".pk-table__row-link");
        for (const options of [{ modifiers: ["ControlOrMeta"] as const }, { button: "middle" as const }]) {
          const opened = page.context().waitForEvent("page");
          await target.click({ ...options, modifiers: options.modifiers ? [...options.modifiers] : undefined });
          const tab = await opened;
          await tab.waitForLoadState();
          expect(new URL(tab.url()).hash).toBe("#m1");
          await tab.close();
        }
      }
      const bob = rows.filter({ hasText: "Bob Martinez" });
      await bob.getByRole("link", { name: "CryptoKey Labs" }).click();
      await expect.poll(() => new URL(page.url()).hash).toBe("#organization-m2");
      await bob.getByRole("button", { name: "Actions for Bob Martinez" }).click();
      await expect(page.getByRole("menuitem", { name: "Send message", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(bob.getByRole("button", { name: "Actions for Bob Martinez" })).toBeFocused();
      await page.screenshot({ path: `test-results/table-row-navigation-${width}.png` });
    });
  }

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
        ".pk-avatar:not(.pk-avatar--xl)": 64,
        ".pk-avatar--xl": 96,
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

/** The agenda gallery includes overlapping time ranges, long titles, and multiple speaker credits. */
test("agenda list cards expand without overlap and print every day as a readable list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/design/?only=agenda");
  const agenda = page.locator("#agenda .pk-content-agenda");
  await expect(agenda.locator("[data-agenda-controls]")).toBeVisible();
  // Exercise the wide toolbar rather than the gallery shell's deliberately narrow specimen column.
  // The page's CSP refuses injected style elements; the CSSOM is not subject to it.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(".pk-preview__main { max-width: none; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await agenda.getByRole("button", { name: "List", exact: true }).click();
    for (const abstracts of [false, true]) {
      const toggle = agenda.locator("[data-agenda-compact]");
      if ((await toggle.getAttribute("aria-pressed")) !== String(abstracts)) {
        if (await toggle.isVisible()) await toggle.click();
        else {
          await agenda.getByRole("button", { name: "Agenda filters and actions", exact: true }).click();
          await page.getByRole("menuitemradio", { name: /session descriptions/ }).click();
        }
      }
      const geometry = await agenda.evaluate((root) => {
        const panel = root.querySelector(".pk-content-agenda__day:not([hidden])")!;
        const cards = [...panel.querySelectorAll<HTMLElement>("[data-agenda-session]")];
        const boxes = cards.map((card) => card.getBoundingClientRect());
        const overlaps = boxes.flatMap((box, index) =>
          boxes
            .slice(index + 1)
            .filter(
              (other) =>
                Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
                Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1,
            ),
        );
        const controls = [
          ...root.querySelectorAll<HTMLElement>(
            "[data-agenda-search], [data-agenda-location-trigger], [data-agenda-track-filter], [data-agenda-compact], [data-agenda-expand], [data-agenda-print], .pk-segmented",
          ),
        ]
          .map((control) => control.getBoundingClientRect().height)
          .filter(Boolean);
        const orderedContent = cards
          .filter((card) => !card.classList.contains("pk-content-agenda__session--break"))
          .every((card) => {
            const room = card.querySelector(".pk-content-agenda__room")!.getBoundingClientRect();
            const body = card.querySelector(".pk-content-agenda__session-body")!.getBoundingClientRect();
            const footer = card.querySelector(".pk-content-agenda__card-footer")!.getBoundingClientRect();
            return (
              body.top >= room.bottom &&
              (footer.height === 0 || footer.top >= body.bottom - 1) &&
              Math.abs(room.width - card.clientWidth) <= 2
            );
          });
        return {
          overlaps: overlaps.length,
          heights: boxes.map((box) => box.height),
          controls,
          orderedContent,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(geometry.overlaps).toBe(0);
      expect(geometry.heights.every((height) => height > 0)).toBe(true);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.orderedContent).toBe(true);
      if (width === 1440) {
        expect(Math.max(...geometry.controls) - Math.min(...geometry.controls)).toBeLessThanOrEqual(1);
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await agenda.getByRole("button", { name: "Grid", exact: true }).click();
  const selectedDays = await agenda
    .locator(".pk-content-agenda__day")
    .evaluateAll((days) => days.map((day) => day.hasAttribute("hidden")));
  const printedHeights: number[] = [];
  for (const abstracts of [false, true]) {
    const toggle = agenda.locator("[data-agenda-compact]");
    if ((await toggle.getAttribute("aria-pressed")) !== String(abstracts)) await toggle.click();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".pk-preview__bar")).toBeHidden();
    await expect(agenda.locator("[data-agenda-controls]")).toBeHidden();
    for (const day of await agenda.locator(".pk-content-agenda__day").all()) {
      await expect(day).toBeVisible();
      await expect(day.locator("caption")).toBeVisible();
    }
    const printed = await agenda.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      const cards = [...root.querySelectorAll<HTMLElement>("[data-agenda-session]")];
      return cards.map((card) => {
        const box = card.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          contained: box.left >= bounds.left && box.right <= bounds.right,
          border: getComputedStyle(card).borderRightWidth,
        };
      });
    });
    expect(printed.every((card) => card.width > 500 && card.contained)).toBe(true);
    expect(printed.filter((card) => card.border !== "0px").length).toBeGreaterThan(0);
    printedHeights.push(printed.reduce((total, card) => total + card.height, 0));
    const descriptions = agenda.locator(".pk-content-agenda__description");
    for (const description of await descriptions.all()) {
      if (abstracts) await expect(description).toBeVisible();
      else await expect(description).toBeHidden();
    }
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    expect(
      await agenda
        .locator(".pk-content-agenda__day")
        .evaluateAll((days) => days.map((day) => day.hasAttribute("hidden"))),
    ).toEqual(selectedDays);
  }
  expect(printedHeights[0]!).toBeLessThan(printedHeights[1]!);
  await expect(agenda.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute("aria-pressed", "true");
});
