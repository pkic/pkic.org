import { expect, test } from "@playwright/test";
import { signInToPortal } from "./helpers/portal-auth";
import { submitProposal, inviteCoSpeaker, PROPOSAL_EVENT_SLUG } from "./helpers/proposals";
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test.use({ actionTimeout: 15_000 });

// Event-only identities deliberately have no staff or membership capacity.
test("attendee opens the same registration from Events and participation history", async ({ page }, testInfo) => {
  const email = `portal-attendee-${Date.now()}@example.test`;
  const since = await capturedEmailCount();
  await registerInBrowser(page, email);
  const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible();
  await signInToPortal(page, email);
  await expect(page).toHaveURL(/#\/events$/);
  await page.getByRole("link", { name: "Open Post-Quantum Cryptography Conference", exact: true }).click();
  await page.getByRole("link", { name: "Manage registration", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("US");
  const recordUrl = page.url();
  await page.getByLabel("Job title", { exact: true }).fill("Updated attendee");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Registration updated.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Job title", { exact: true })).toHaveValue("Updated attendee");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My participation", exact: true }).click();
  await page.getByRole("list", { name: "Event registrations" }).getByRole("link").click();
  await expect(page).toHaveURL(recordUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel registration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore registration" })).toBeVisible();
  await page.getByRole("button", { name: "Restore registration" }).click();
  await expect(page.getByRole("button", { name: "Cancel registration", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("registration-mobile.png"), fullPage: true });
});

test("proposer and invited speaker manage their own event records without emailed management tokens", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/portal/");
  const proposerEmail = `portal-proposer-${Date.now()}@example.test`;
  const speakerEmail = `portal-speaker-${Date.now()}@example.test`;
  const title = `Portal proposal ${Date.now()}`;
  const proposal = await submitProposal(page, {
    proposerEmail,
    firstName: "Portal",
    lastName: "Proposer",
    title,
    abstract:
      "A sufficiently detailed proposal describing how participants can manage their event records directly in the portal.",
  });
  expect(
    await inviteCoSpeaker(page, proposal.accessToken, {
      email: speakerEmail,
      firstName: "Portal",
      lastName: "Speaker",
    }),
  ).toBe(200);
  await signInToPortal(page, proposerEmail);
  await page.getByRole("link", { name: "Open Post-Quantum Cryptography Conference", exact: true }).click();
  await page.getByRole("link", { name: "View your proposals and speaker participation" }).click();
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title + " edited");
  await page.getByRole("button", { name: "Save proposal", exact: true }).click();
  await expect(page.getByText("Proposal updated.", { exact: true })).toBeVisible();
  const recordUrl = page.url();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My participation", exact: true }).click();
  await page.getByRole("link", { name: title + " edited", exact: true }).click();
  await expect(page).toHaveURL(recordUrl);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title + " edited");
  await page.screenshot({ path: testInfo.outputPath("proposal-desktop.png"), fullPage: true });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const speaker = await context.newPage();
  try {
    await signInToPortal(speaker, speakerEmail);
    await speaker.goto(`/portal/#/events/${PROPOSAL_EVENT_SLUG}/proposals/${proposal.proposalId}`);
    await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeVisible();
    for (const checkbox of await speaker.getByRole("checkbox").all()) await checkbox.check();
    await speaker.getByRole("button", { name: "Confirm participation", exact: true }).click();
    await expect(speaker.getByText("Participation confirmed.", { exact: true })).toBeVisible();
    await expect(speaker.getByRole("button", { name: "Save proposal", exact: true })).toHaveCount(0);
    await speaker.getByLabel("Job title", { exact: true }).fill("Guest speaker");
    await speaker.getByRole("button", { name: "Save speaker profile", exact: true }).click();
    await expect(speaker.getByText("Speaker profile saved.", { exact: true })).toBeVisible();
    await speaker.reload();
    await expect(speaker.getByLabel("Job title", { exact: true })).toHaveValue("Guest speaker");
  } finally {
    await context.close();
  }
});
