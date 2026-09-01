import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/**
 * What the portal looks like, at the sizes people use it at.
 *
 * Every other check in this suite asks whether something works. This one asks
 * whether the result is presentable, because the failures that reached the
 * maintainer were all of that kind: columns adrift in dead space on a wide
 * screen, a control eight pixels shorter than the field beside it, a page with
 * no subject. None of them break a test that looks for a role and a name.
 *
 * It cannot judge beauty. What it can do is hold the measurable part — nothing
 * escapes its container, nothing is illegible, the list is measured rather than
 * stretched — and leave a screenshot at each size for a person to look at.
 */

const SIZES = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
  { name: "wide", width: 2000, height: 1200 },
] as const;

const SCREENS = [
  { name: "home", path: "/portal/#/" },
  { name: "users", path: "/portal/#/users" },
  { name: "organizations", path: "/portal/#/organizations" },
] as const;

test.describe("the portal's appearance", () => {
  test("is composed at every size", async ({ page }) => {
    // One sign-in for all sizes: each size signing in separately tripped the
    // per-address sign-in limiter on the fourth attempt, which failed the
    // widest size for a reason that had nothing to do with appearance.
    await page.setViewportSize({ width: 1280, height: 900 });
    await signInToPortal(page, e2eAdminEmail("portal-appearance"));

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.locator("#portal-root")).toBeVisible();
        await page.waitForLoadState("networkidle");

        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(sideways, `${screen.name} scrolls sideways at ${size.width}px`).toBe(false);

        const layout = await page.evaluate(() => {
          const table = document.querySelector("table.pk-table");
          if (!table) return null;
          const main = document.querySelector("#portal-main") ?? document.body;
          const room = main.getBoundingClientRect().width;
          const width = table.getBoundingClientRect().width;
          const headers = [...table.querySelectorAll("th")];
          const primary = headers.find((th) => th.classList.contains("pk-table__col--primary"));
          return {
            fills: width >= Math.min(room, main.clientWidth) * 0.9,
            hasPrimary: primary !== undefined,
          };
        });
        if (layout) {
          expect(layout.fills, `${screen.name}'s table leaves the width unused at ${size.width}px`).toBe(true);
          expect(layout.hasPrimary, `${screen.name}'s table has no slack column`).toBe(true);
        }

        await test.info().attach(`${screen.name}-${size.name}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
      }
    }
  });
});
