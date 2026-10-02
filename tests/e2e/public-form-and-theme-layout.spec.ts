/** @covers presentation.13.1 */
import { expect, test } from "@playwright/test";

const eventPath = "/events/2026/pqc-conference-amsterdam-nl";

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} shared public layouts`, () => {
    test.use({ colorScheme });

    test("proposal fills its container and the warning starts beside its icon", async ({ page }) => {
      await page.goto(`${eventPath}/propose/`);
      const form = page.locator("form.pk-form");
      await expect(form).toBeVisible();
      await expect(form).toHaveCSS("display", "flex");
      expect(
        await form.evaluate((element) => {
          return element.getBoundingClientRect().width / element.parentElement!.getBoundingClientRect().width;
        }),
      ).toBeGreaterThan(0.95);
      await page.goto(`${eventPath}/register/`);
      expect(
        await page
          .locator("blockquote")
          .filter({ hasText: "In-person registration is currently full" })
          .locator("p")
          .first()
          .evaluate((element) => getComputedStyle(element).marginTop),
      ).toBe("0px");
      await page.screenshot({ path: test.info().outputPath("registration-callout.png"), fullPage: true });
    });

    test("search opens, accepts focus, and closes on group and event pages", async ({ page }) => {
      for (const path of ["/wg/cm/", "/wg/pqc/", "/events/"]) {
        await page.goto(path);
        await page.getByRole("button", { name: "Open search", exact: true }).filter({ visible: true }).click();
        await expect(page.locator("#pkicSearchPanel")).toBeVisible();
        await expect(page.locator("#pkicSearchInput")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.locator("#pkicSearchPanel")).toBeHidden();
      }
    });

    test("agenda cards, session details, and expanded view follow the theme", async ({ page }) => {
      await page.goto(`${eventPath}/agenda/`);
      const card = page.locator(".pk-content-agenda__session").filter({ visible: true }).first();
      await expect(card).toBeVisible();
      const surface = await card.evaluate((element) => {
        const probe = document.createElement("span");
        const sheet = new CSSStyleSheet();
        sheet.replaceSync("[data-theme-surface-probe] { background: var(--pk-surface); }");
        probe.setAttribute("data-theme-surface-probe", "");
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        element.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
        return color;
      });
      await expect(card).not.toHaveCSS("background-color", surface);
      await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await card.getByRole("button", { name: /Open session details/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCSS("background-color", surface);
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByRole("button", { name: "Expand agenda", exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
      await expect(page.locator(".pk-agenda-dialog[open]")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
      await expect(page.locator(".pk-agenda-dialog[open]")).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".pk-content-agenda__session").filter({ visible: true }).first()).not.toHaveCSS(
        "background-color",
        surface,
      );
      await page.screenshot({ path: test.info().outputPath("agenda-mobile.png"), fullPage: true });
    });

    test("working-group cards use the shared surface and readable text", async ({ page }) => {
      await page.goto("/wg/cm/");
      const colors = await page
        .locator(".wg-explore-card")
        .first()
        .evaluate((element) => {
          const probe = document.createElement("span");
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(
            "[data-theme-surface-probe] { background: var(--pk-surface); } [data-theme-section-probe] { background: var(--pk-surface-sunk); }",
          );
          probe.setAttribute("data-theme-surface-probe", "");
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
          document.body.appendChild(probe);
          const surface = getComputedStyle(probe).backgroundColor;
          probe.removeAttribute("data-theme-surface-probe");
          probe.setAttribute("data-theme-section-probe", "");
          const sectionSurface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
          return {
            surface,
            card: getComputedStyle(element).backgroundColor,
            sectionSurface,
            section: getComputedStyle(element.closest(".wg-alt-section")!).backgroundColor,
          };
        });
      expect(colors.card).toBe(colors.surface);
      expect(colors.section).toBe(colors.sectionSurface);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath("working-group-mobile.png"), fullPage: true });
    });

    test("event cards, agenda tabs, and registration controls use distinct theme surfaces", async ({ page }) => {
      await page.goto(`${eventPath}/`);
      const card = page.locator(".bento-card.bento-orange-pale").first();
      await expect(card).toBeVisible();
      if (colorScheme === "dark") {
        expect(await card.evaluate((element) => getComputedStyle(element).backgroundImage)).toBe("none");
        expect(await card.evaluate((element) => getComputedStyle(element).color)).toBe(
          await page.locator("body").evaluate((element) => getComputedStyle(element).color),
        );
      }

      await page.goto(`${eventPath}/agenda/`);
      const day = page.locator("[data-agenda-tab]").filter({ visible: true }).first();
      await expect(day).toBeVisible();
      if (colorScheme === "dark") {
        expect(await day.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
          await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
        );
      }

      await page.goto(`${eventPath}/register/`);
      await expect(page.getByRole("textbox", { name: "First name (required)", exact: true })).toBeVisible();
      await expect(page.getByLabel("Event identity")).toHaveCount(0);
      if (colorScheme === "dark") {
        const input = page.getByRole("textbox", { name: "First name (required)", exact: true });
        expect(await input.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
          await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
        );
      }
    });
  });
}
