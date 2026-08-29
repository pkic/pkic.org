import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

function clientIpForIdentity(email: string): string {
  const suffix = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 8);
  return `2001:db8::${suffix.slice(0, 4)}:${suffix.slice(4)}`;
}

/** Establishes a real portal session through the same mailbox capability used by users. */
export async function signInToPortal(page: Page, email: string): Promise<void> {
  // Model independent users arriving from independent clients. The complete
  // serial suite otherwise funnels every sign-in through Wrangler's one local
  // address and exhausts the production-equivalent per-IP limiter.
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  await page.goto("/portal/");
  await expect(page.locator("#portal-inp-email")).toBeVisible({ timeout: 10_000 });
  await page.locator("#portal-inp-email").fill(email);
  const since = await capturedEmailCount();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();
  const emailMessage = await waitForCapturedEmail(email, "sign-in link", { since });
  await page.goto(extractEmailUrl(emailMessage, "/portal/"));
  // A user normally opens the email in a new tab. In this helper the portal
  // application is already mounted, and a hash-only navigation does not rerun
  // its one-time verifier; reload to model that fresh-tab mount.
  await page.reload();
  // The login heading remains visible while the hash verifier redeems the
  // capability, so waiting for that text would return before a session exists.
  await expect(page.locator("#portal-inp-email")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/portal\/#\/(?!verify(?:$|[/?]))[^?#]+/, { timeout: 15_000 });
}
