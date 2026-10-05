import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

export async function useEmailPreviewLogoFixture(page: Page) {
  await page.route("https://pkic.org/img/logo-white.png", (route) =>
    route.fulfill({
      path: fileURLToPath(new URL("../../../static/img/logo-white.png", import.meta.url)),
      contentType: "image/png",
    }),
  );
}

/** Verify both email style sources inside the isolated renderer. */
export async function expectStyledEmailPreview(preview: Locator) {
  await expect(preview).toHaveAttribute("src", "/email/preview/");
  const renderer = preview.contentFrame();
  await expect(renderer.getByTitle("Email HTML", { exact: true })).toHaveAttribute("sandbox", "");
  const email = renderer.getByTitle("Email HTML", { exact: true }).contentFrame();
  const logo = email.getByRole("img", { name: "PKI Consortium", exact: true });
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(logo.locator("xpath=ancestor::td[1]")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(email.locator("p").first()).toHaveCSS("color", "rgb(55, 65, 81)");
}
