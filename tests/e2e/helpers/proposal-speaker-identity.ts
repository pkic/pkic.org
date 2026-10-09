import { expect, type Page, type TestInfo } from "@playwright/test";

export async function captureResponsive(page: Page, info: TestInfo, phase: string): Promise<void> {
  await page.getByRole("heading", { level: 1 }).click();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [390, 844, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    if (phase === "current-invited-representation-role") {
      const representation = page.getByRole("group", { name: "Your representation for this proposal", exact: true });
      const summary = await representation.locator("dl").boundingBox();
      const group = await representation.boundingBox();
      expect(summary).not.toBeNull();
      expect(group).not.toBeNull();
      expect(summary!.width).toBeGreaterThanOrEqual(group!.width * 0.9);
      const update = await representation
        .getByRole("button", { name: "Update current representation", exact: true })
        .boundingBox();
      expect(update).not.toBeNull();
      expect(update!.height).toBeLessThanOrEqual(64);
    }
    if (phase === "invited-speaker-work-proof") {
      const steps = [
        "[data-confirm-form]",
        "[data-profile-section]",
        "[data-headshot-section]",
        "[data-participation-actions]",
      ];
      const boxes = [];
      for (const selector of steps) {
        const section = page.locator(selector);
        await expect(section).toBeVisible();
        const box = await section.boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }
      for (let index = 1; index < boxes.length; index++)
        expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
      const confirmation = page.getByRole("button", { name: "Confirm participation", exact: true });
      await expect(confirmation).toHaveAttribute("form", "speaker-participation-confirm");
      await expect(confirmation).toBeDisabled();
      await expect(page.getByRole("button", { name: "Decline participation…", exact: true })).toBeEnabled();
    }
    await page.screenshot({ path: info.outputPath(`${phase}-${device}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
