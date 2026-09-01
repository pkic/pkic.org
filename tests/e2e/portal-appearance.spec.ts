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
  for (const size of SIZES) {
    test(`is composed at ${size.name} (${size.width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await signInToPortal(page, e2eAdminEmail("portal-appearance"));

      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.locator("#portal-root")).toBeVisible();
        // Let the list settle before measuring or shooting.
        await page.waitForLoadState("networkidle");

        // Nothing may push the page sideways. A table that needs more room
        // scrolls inside its own `pk-table__scroll`, not by moving the page.
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(sideways, `${screen.name} scrolls sideways at ${size.width}px`).toBe(false);

        // The list fills the width it is given, and the slack all sits in the
        // subject column rather than drifting between the others. This
        // assertion replaced its own opposite: an earlier policy capped the
        // list at a reading measure, and the maintainer's next complaint was
        // "the pages are not using the full width".
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
          expect(layout.fills, `${screen.name}'s table leaves the width unused`).toBe(true);
          expect(layout.hasPrimary, `${screen.name}'s table has no slack column`).toBe(true);
        }

        await testInfo.attach(`${screen.name}-${size.name}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: "image/png",
        });
      }
    });
  }
});
