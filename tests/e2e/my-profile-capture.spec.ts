import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";

const OUT = process.env["CAPTURE_DIR"];

/** The member's own profile as an image, for design review. */
test("captures my profile", async ({ page }) => {
  test.skip(!OUT, "Set CAPTURE_DIR to the directory the images should be written to.");

  await signInToPortal(page, "paul.vanbrouwershaven@pkic.org");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/portal/#/profile");
  await expect(page.getByRole("heading", { name: "Paul van Brouwershaven", level: 2 })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/my-profile.png`, fullPage: true });
});
