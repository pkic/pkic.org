import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";

const OUT = process.env["CAPTURE_DIR"];

/**
 * Not an assertion suite: a capture run that renders the contact record to PNG
 * for design review, in both color schemes. It is skipped unless `CAPTURE_DIR`
 * names an output directory, so the gate never spends time producing images
 * nobody asked for.
 */
test("captures the contact record", async ({ page }) => {
  test.skip(!OUT, "Set CAPTURE_DIR to the directory the images should be written to.");

  await signInToPortal(page, "admin@pkic.org");

  const userId = await page.evaluate(async () => {
    const res = await fetch("/api/v1/users?limit=5&q=paul.vanbrouwershaven%40pkic.org");
    const body = (await res.json()) as { users?: Array<{ id: string; email: string }> };
    return body.users?.find((user) => user.email === "paul.vanbrouwershaven@pkic.org")?.id ?? "";
  });
  expect(userId).not.toBe("");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/portal/#/users/${userId}`);
  await expect(page.getByRole("heading", { name: "Paul van Brouwershaven" })).toBeVisible();
  await expect(page.getByText("33 of 41 meetings attended")).toBeVisible();

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/contact-record-${scheme}.png`, fullPage: true });
  }
});
