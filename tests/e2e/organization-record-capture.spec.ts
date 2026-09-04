import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";

const OUT = process.env["CAPTURE_DIR"];

/**
 * The organization record as an image, for design review. Skipped unless
 * `CAPTURE_DIR` names an output directory, so the gate never spends time
 * producing pictures nobody asked for.
 */
test("captures the organization record", async ({ page }) => {
  test.skip(!OUT, "Set CAPTURE_DIR to the directory the images should be written to.");

  await signInToPortal(page, "admin@pkic.org");

  const organizationId = await page.evaluate(async () => {
    const res = await fetch("/api/v1/organizations?limit=5&q=Digitorus");
    const body = (await res.json()) as { organizations?: Array<{ id: string; name: string }> };
    return body.organizations?.find((organization) => organization.name === "Digitorus")?.id ?? "";
  });
  expect(organizationId).not.toBe("");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/portal/#/organizations/${organizationId}`);
  await expect(page.getByRole("heading", { name: "Digitorus", level: 2 })).toBeVisible();

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/organization-record-${scheme}.png`, fullPage: true });
  }
});
