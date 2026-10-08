import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { siteSecurityHeaders } from "../../../assets/shared/site-security-policy";

/** Inspect the native response, not just the policy source or an iframe attribute. */
export function expectPortalEmailPreviewPolicy(response: Response | null) {
  expect(response).not.toBeNull();
  if (!response) throw new Error("Portal navigation returned no document response");
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe("/portal/");
  const canonical = siteSecurityHeaders("/portal/");
  expect(response.headers()["content-security-policy"]).toBe(canonical["Content-Security-Policy"]);
  expect(response.headers()["permissions-policy"]).toBe(canonical["Permissions-Policy"]);
}

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
