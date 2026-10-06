import { expect, type Locator } from "@playwright/test";
import { contrastRatio } from "../../../assets/design/color";

/** Measure actual rendered button text colors, including browser-resolved color mixes. */
export async function expectButtonTextContrast(button: Locator) {
  await expect
    .poll(async () => {
      const colors = await button.evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const filter = getComputedStyle(element).filter;
        const brightness = filter === "none" ? 1 : Number(/^brightness\(([\d.]+)\)$/.exec(filter)?.[1]);
        if (!Number.isFinite(brightness)) throw new Error(`Unsupported contrast filter: ${filter}`);
        function rgb(color: string) {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return {
            r: Math.min((r / 255) * brightness, 1),
            g: Math.min((g / 255) * brightness, 1),
            b: Math.min((b / 255) * brightness, 1),
          };
        }
        return {
          background: rgb(getComputedStyle(element).backgroundColor),
          text: [...element.querySelectorAll("span")].map((label) => rgb(getComputedStyle(label).color)),
        };
      });
      return Math.min(...colors.text.map((color) => contrastRatio(color, colors.background)));
    })
    .toBeGreaterThanOrEqual(4.5);
}
