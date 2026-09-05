/**
 * Sponsorship inquiry for a named tier.
 *
 * The existing inquiry journey deliberately submits "not sure" — the path
 * where the applicant has not chosen a tier. A named tier takes a different
 * branch: the selection has to survive into the stored inquiry and into both
 * rendered emails. Nothing exercised that, so a tier that failed to resolve
 * would have shown up only as an unresolved placeholder in a real message.
 *
 * @covers sponsor.2.2
 */
import { expect, test } from "@playwright/test";
import { waitForCapturedEmail } from "./helpers/sendgrid";
import { uniqueSuffix } from "./helpers/membership";

test("submits a sponsor inquiry for a named tier and renders both messages", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `sponsor-tier-${suffix}@example.test`;
  const organizationName = `Named Tier Sponsor ${suffix}`;

  await page.goto("/sponsors/sponsor/");
  const tier = page.locator("#tier");
  await expect(tier).toBeEnabled();

  const namedTiers = await tier
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter((value) => value && value !== "__not_sure__"),
    );
  expect(namedTiers.length, "the seeded catalog must offer at least one named tier").toBeGreaterThan(0);
  const chosenTier = namedTiers[0];

  await page.locator("#firstName").fill("Robin");
  await page.locator("#lastName").fill("Sponsor");
  await page.locator("#email").fill(email);
  await page.locator("#organizationName").fill(organizationName);
  await tier.selectOption(chosenTier);
  await page.locator("#comments").fill("We would like to discuss this tier for the coming year.");

  const submission = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/sponsors/inquiries") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /submit your interest/i }).click();
  expect((await submission).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Thanks for your interest!" })).toBeVisible();

  const applicantMessage = await waitForCapturedEmail(email, "PKI Consortium sponsorship information");
  const applicantContent = applicantMessage.payload.content as Array<{ type: string; value: string }> | undefined;
  const applicantRendered = applicantContent?.map(({ value }) => value).join("\n") ?? "";
  expect(applicantRendered, "no template placeholder may survive rendering").not.toMatch(/\{\{[^}]+\}\}/);

  const staffMessage = await waitForCapturedEmail("sponsorships@pkic.org", "New sponsorship inquiry");
  const staffContent = staffMessage.payload.content as Array<{ type: string; value: string }> | undefined;
  const staffRendered = staffContent?.map(({ value }) => value).join("\n") ?? "";
  expect(staffRendered).not.toMatch(/\{\{[^}]+\}\}/);
  // The point of the named-tier branch: staff must be told which tier was
  // asked for, or the inquiry is no more useful than "not sure".
  expect(staffRendered).toContain(chosenTier);
  expect(staffRendered).toContain(organizationName);
});
