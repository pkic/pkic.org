/** @covers presentation.13.1 */
import { expect, test, type Locator } from "@playwright/test";
import axe from "axe-core";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";

const eventPath = "/events/2026/pqc-conference-amsterdam-nl";
/** The widest phone layout: below 47.5rem the agenda lists its sessions and hides the expanded view. */
const PHONE_MAX_WIDTH = 760;

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
        // The navbar field on wide screens, the panel's own field on narrow ones: whichever the reader sees.
        await expect(
          page.getByRole("searchbox", { name: "Search", exact: true }).filter({ visible: true }),
        ).toBeFocused();
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
      /*
       * A timeline card is sunk below the surface it sits on. The phone list sits on the page itself and its
       * cards are white surface cards, set off by their border (in the light theme the page is white too).
       */
      const expectCardStandsOut = async (session: Locator) => {
        const listView = await session.evaluate(
          (element) => element.closest(".pk-content-agenda")?.getAttribute("data-agenda-view") === "list",
        );
        if (!listView) {
          await expect(session).not.toHaveCSS("background-color", surface);
          return;
        }
        await expect(session).toHaveCSS("background-color", surface);
        await expect(session).not.toHaveCSS("border-top-width", "0px");
        await expect(session).not.toHaveCSS("border-top-color", surface);
        await expect(session).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
      };
      const phone = (page.viewportSize()?.width ?? 0) < PHONE_MAX_WIDTH;
      await expectCardStandsOut(card);
      await expect(card).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await card.getByRole("button", { name: /Open session details/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCSS("background-color", surface);
      await page.getByRole("dialog").getByRole("button", { name: "Close session details", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      const expand = page.getByRole("button", { name: "Expand agenda", exact: true });
      if (phone) {
        // A phone already shows the agenda at full width: it offers no expanded view.
        await expect(expand).toBeHidden();
      } else {
        await expand.filter({ visible: true }).click();
        await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
        await expect(page.locator(".pk-agenda-dialog[open]")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await page.keyboard.press("Escape");
        await expect(page.locator(".pk-agenda-dialog[open]")).toHaveCount(0);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expectCardStandsOut(page.locator(".pk-content-agenda__session").filter({ visible: true }).first());
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
      await expect(
        page.getByRole("textbox", { name: EMAIL_FIRST_COPY.registration.work.label, exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Representation")).toHaveCount(0);
      if (colorScheme === "dark") {
        const input = page.getByRole("textbox", { name: EMAIL_FIRST_COPY.registration.work.label, exact: true });
        expect(await input.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
          await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
        );
      }
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} working-group accents`, () => {
    test.use({ colorScheme });
    test("working-group pages and dark model trees retain readable group colors", async ({ page }, testInfo) => {
      if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
      for (const [route, accent] of [
        ["/wg/pqc/pqcmm/", "blue"],
        ["/wg/pkimm/model/", "purple"],
        ["/wg/cbom/charter/", "teal"],
      ]) {
        await page.goto(route!);
        await expect(page.locator("body")).toHaveClass(new RegExp(`pk-page--${accent}`));
        await page.evaluate(
          (theme) => {
            document.documentElement.dataset.theme = theme;
          },
          colorScheme === "light" ? "dark" : "light",
        );
        const heading = page.locator(".wg-main-content h2, .wg-prose h2").first();
        if (await heading.count()) {
          expect(
            await heading.evaluate((element) => {
              const probe = document.createElement("span");
              probe.style.color = "var(--pk-accent-ink)";
              element.appendChild(probe);
              const expected = getComputedStyle(probe).color;
              probe.remove();
              return getComputedStyle(element).color === expected;
            }),
          ).toBe(true);
          await expect(heading).toHaveCSS("background-image", "none");
        }
        const sidebar = page.locator(".wg-sidebar");
        if (await sidebar.count()) {
          await sidebar
            .locator("details")
            .first()
            .evaluate((element) => {
              (element as HTMLDetailsElement).open = true;
            });
          await page.evaluate(axe.source);
          const violations = await page.evaluate(
            async () =>
              (
                await (window as unknown as { axe: typeof axe }).axe.run(".wg-sidebar", {
                  runOnly: { type: "rule", values: ["color-contrast"] },
                })
              ).violations,
          );
          expect(
            violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.html) })),
          ).toEqual([]);
        }
        await page.screenshot({ path: testInfo.outputPath(`${accent}-working-group.png`), fullPage: false });
      }
    });
  });
}
