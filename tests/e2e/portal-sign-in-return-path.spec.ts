import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { clientIpForIdentity } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

/**
 * A public "Join this working group" button sends a signed-out reader to the
 * group's portal page. The sign-in that interrupts them has to bring them
 * back there — through the link in the email, which opens in a fresh tab —
 * rather than dropping them on the portal's front page.
 */
test("a sign-in started on a working group page returns there from the emailed link", async ({ page }) => {
  const email = e2eAdminEmail("portal-sign-in-return-path");
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });

  await page.goto("/portal/#/groups/pqc");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Email").fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();

  const message = await waitForCapturedEmail(email, "sign-in link", { since });
  const link = extractEmailUrl(message, "/portal/");
  expect(link).toContain("next=%2Fgroups%2Fpqc");

  // The email opens in a new tab: a fresh mount, no state carried over.
  const fresh = await page.context().newPage();
  await fresh.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  await fresh.goto(link);
  // The workspace canonicalizes the slug to the group's id once it has
  // loaded, so the landing is judged by the group on screen, not the slug.
  await expect(fresh.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(fresh).toHaveURL(/\/portal\/#\/groups\/[^/?]+/, { timeout: 15_000 });
});
