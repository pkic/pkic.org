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

    test("agenda cards, dialogs, and fullscreen follow the theme", async ({ page }) => {
      await page.goto(`${eventPath}/agenda/`);
      const card = page.locator(".session-card").filter({ visible: true }).first();
      await expect(card).toBeVisible();
      const surface = await card.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.background = "var(--pk-surface)";
        element.appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      await expect(card).toHaveCSS("background-color", surface);
      await card.getByRole("button", { name: /Open session details/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCSS("background-color", surface);
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByRole("button", { name: "Toggle Fullscreen", exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole("button", { name: "Exit Fullscreen", exact: true })).toBeVisible();
      await expect(page.locator(".agenda-fullscreen")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
      await expect(page.locator(".agenda-fullscreen")).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator(".mobile-session-card").filter({ visible: true }).first()).toHaveCSS(
        "background-color",
        surface,
      );
    });

    test("working-group cards use the shared surface and readable text", async ({ page }) => {
      await page.goto("/wg/cm/");
      const colors = await page
        .locator(".wg-explore-card")
        .first()
        .evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.background = "var(--pk-surface)";
          document.body.appendChild(probe);
          const surface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { surface, card: getComputedStyle(element).backgroundColor };
        });
      expect(colors.card).toBe(colors.surface);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}
