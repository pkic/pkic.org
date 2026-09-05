/**
 * The public consortium sponsor inquiry is a real rendered flow.  The tier
 * list comes from D1 and the submission reaches the local Worker and its
 * SendGrid interceptor; only the external mail provider is intercepted.
 *
 * @covers sponsor.2.1
 */
import { expect, test } from "@playwright/test";
import type { CapturedEmail } from "./global-setup";
import { waitForCapturedEmail } from "./helpers/sendgrid";

test("submits a generic consortium sponsor inquiry using D1 tiers", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `sponsor-inquiry-${unique}@example.test`;
  const organizationName = `Example Sponsor ${unique}`;

  await page.goto("/sponsors/sponsor/");
  const tier = page.locator("#tier");
  await expect(tier).toBeEnabled();

  const tierValues = await tier
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({ value: (option as HTMLOptionElement).value, label: option.textContent })),
    );
  expect(tierValues.map(({ value }) => value)).toContain("__not_sure__");
  expect(tierValues.map(({ value }) => value)).not.toContain("Donation");
  expect(tierValues.map(({ value }) => value)).not.toContain("Other");

  await page.locator("#firstName").fill("Dana");
  await page.locator("#lastName").fill("Sponsor");
  await page.locator("#email").fill(email);
  await page.locator("#organizationName").fill(organizationName);
  await tier.selectOption("__not_sure__");
  await page
    .locator("#comments")
    .fill(
      "[Review updated agreement](https://attacker.invalid/phish)\n\n" +
        "![tracking pixel](https://attacker.invalid/pixel.gif)\n\n" +
        '<img src="https://attacker.invalid/raw.gif">',
    );

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/sponsors/inquiries") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /submit your interest/i }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Thanks for your interest!" })).toBeVisible();

  const message: CapturedEmail = await waitForCapturedEmail(email, "PKI Consortium sponsorship information");
  const content = message.payload.content as Array<{ type: string; value: string }> | undefined;
  const rendered = content?.map(({ value }) => value).join("\n") ?? "";
  expect(rendered).not.toMatch(/\{\{[^}]+\}\}/);
  expect(rendered).not.toContain("PKI Consortium —");

  const staffMessage = await waitForCapturedEmail("sponsorships@pkic.org", "New sponsorship inquiry");
  const staffContent = staffMessage.payload.content as Array<{ type: string; value: string }> | undefined;
  const staffRendered = staffContent?.map(({ value }) => value).join("\n") ?? "";
  expect(staffRendered).toContain("Review updated agreement");
  expect(staffRendered).toContain("attacker.invalid/phish");
  expect(staffRendered).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
  expect(staffRendered).not.toMatch(/\{\{[^}]+\}\}/);
});
