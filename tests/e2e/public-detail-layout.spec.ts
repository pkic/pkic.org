/** Public working-group navigation regressions. @covers presentation.13.7 */
import { expect, test } from "@playwright/test";

test("working-group subpages separate Join from Back at both widths", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const slug of ["pkimm", "tcwg"]) {
      await page.goto(`/wg/${slug}/focus/`);
      const actions = page.locator(".wg-page-actions");
      const join = actions.getByRole("link", { name: /^Join/ });
      const back = actions.getByRole("link", { name: /Back to/ });
      const joinBox = await join.boundingBox();
      const backBox = await back.boundingBox();
      expect(backBox!.y - joinBox!.y - joinBox!.height).toBeGreaterThanOrEqual(15);
      expect(joinBox!.width).toBeLessThan(width - 24);
      await expect(back).toHaveAttribute("href", new RegExp(`/wg/${slug}/`));
    }
  }
});
