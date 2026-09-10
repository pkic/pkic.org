/** @covers account.7.1 */
import { test, expect } from "@playwright/test";
import { openEmailSignIn } from "./helpers/portal-auth";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 1366 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`login fills the page without a gap below its side panel at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/portal/");
    await openEmailSignIn(page);
    const layout = await page.evaluate(() => {
      const login = document.querySelector(".pk-login")!.getBoundingClientRect();
      const backdrop = document.querySelector(".pk-login__backdrop")!.getBoundingClientRect();
      const footer = document.querySelector("footer")!.getBoundingClientRect();
      return {
        loginBottom: login.bottom,
        backdropBottom: backdrop.bottom,
        footerTop: footer.top,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(layout.overflow).toBe(0);
    expect(Math.abs(layout.footerTop - layout.loginBottom)).toBeLessThanOrEqual(1);
    if (viewport.width >= 1024) expect(Math.abs(layout.backdropBottom - layout.loginBottom)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: test.info().outputPath(`login-${viewport.width}.png`),
      fullPage: true,
    });
  });
}
