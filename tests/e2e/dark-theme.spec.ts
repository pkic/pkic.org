import { expect, test, type Page } from "@playwright/test";

/**
 * The dark theme has to reach the page, not only the components.
 *
 * The site spent its whole life on a white ground that the browser supplied by
 * default, so a surface could hard-code `#fff` and nobody would see it. The
 * moment a reader can choose the dark theme, each of those becomes a light
 * island carrying near-white text — unreadable, and invisible to every check
 * that reads source rather than pixels. Seven surfaces were in that state when
 * the toggle went in.
 *
 * So this reads what the browser actually computed, on the pages a visitor
 * lands on first.
 */

const PAGES = ["/", "/about/", "/members/", "/blog/", "/sponsors/", "/events/"];

/** Relative luminance, or null when the colour is transparent. */
const LUMINANCE = `(value) => {
  const parts = value.match(/[\\d.]+/g);
  if (!parts) return null;
  // A translucent background composites onto whatever is behind it, so it
  // cannot be judged on its own — a white card at 6% opacity is how a panel
  // sits on the dark hero, and it is correct there.
  if (parts[3] !== undefined && Number(parts[3]) < 1) return null;
  const [r, g, b] = parts.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}`;

async function unreadableSurfaces(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const luminance = ${LUMINANCE};
    const found = new Set();
    for (const element of document.querySelectorAll("main *, footer *")) {
      const box = element.getBoundingClientRect();
      // Something big enough to read text on. A 20px chip that borrows its
      // ground from a parent is not what this is looking for.
      if (box.width < 200 || box.height < 60) continue;
      const styles = getComputedStyle(element);
      const ground = luminance(styles.backgroundColor);
      if (ground === null) continue;
      const ink = luminance(styles.color);
      const lightGroundInDarkTheme = ground > 0.75;
      const inkTooCloseToGround = ink !== null && Math.abs(ground - ink) < 0.25;
      if (lightGroundInDarkTheme || inkTooCloseToGround) {
        found.add(element.tagName.toLowerCase() + "." + String(element.className).slice(0, 40) +
          " background " + styles.backgroundColor + ", text " + styles.color);
      }
    }
    return [...found];
  })()`);
}

test.describe("the dark theme", () => {
  test.use({ colorScheme: "dark" });

  for (const path of PAGES) {
    test(`leaves nothing unreadable on ${path}`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("pk-theme", "dark");
        } catch {
          // A browser that refuses storage still honours the OS preference.
        }
      });
      await page.goto(path);
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 20, 23)");
      expect(await unreadableSurfaces(page)).toEqual([]);
    });
  }

  test("remembers the reader's choice and hands it back", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await expect(toggle).toBeVisible();

    // The OS preference is dark here, and the reader has chosen nothing yet.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Back to following the system, which is the state the attribute cannot
    // express and a two-way switch would have taken away.
    await toggle.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });
});
