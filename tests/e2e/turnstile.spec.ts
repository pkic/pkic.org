import { expect, test } from "@playwright/test";
import { memberJoinStartSchema } from "../../assets/shared/schemas/member-join";

// Synthetic widget responses exercise our browser integration; live Cloudflare verification is separate.
test("public join preserves input on cancel and submits once after verification", async ({ page }) => {
  let completed = 0;
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = { render(container, options) {
      const button = document.createElement('button'); button.textContent = 'Complete test verification';
      button.addEventListener('click', () => options.callback('test-fresh-token'));
      container.append(button); return 'test-widget';
    }, remove() {} };`,
    }),
  );
  await page.route("**/api/v1/members/join/start", async (route) => {
    memberJoinStartSchema.parse(route.request().postDataJSON());
    if (!route.request().headers()["x-turnstile-token"]) {
      await route.fulfill({
        status: 403,
        json: {
          error: {
            code: "TURNSTILE_REQUIRED",
            message: "Verify",
            details: { siteKey: "test-site", action: "membership_join" },
          },
        },
      });
    } else {
      expect(route.request().headers()["x-turnstile-token"]).toBe("test-fresh-token");
      completed++;
      await route.continue();
    }
  });
  await page.goto("/join/");
  await page.getByLabel("Yes — I am employed by or own an organization").check();
  const email = page.getByLabel("Your official work or organization email address");
  await email.fill(`turnstile-${Date.now()}@organization.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Verify to continue" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await page.screenshot({ path: "/Volumes/ScanDisk/mac-caches/tmp/pkic-turnstile-dialog.png", fullPage: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(email).not.toHaveValue("");
  expect(completed).toBe(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Complete test verification" }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/We sent an email/)).toBeVisible();
  expect(completed).toBe(1);
});
