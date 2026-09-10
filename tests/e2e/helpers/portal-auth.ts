import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

/** A stable per-identity client address, so parallel sign-ins do not share one rate-limit bucket. */
export function clientIpForIdentity(email: string): string {
  const suffix = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 8);
  return `2001:db8::${suffix.slice(0, 4)}:${suffix.slice(4)}`;
}

/**
 * Opens the email sign-in form.
 *
 * The passkey is the screen's primary action and the email link folds behind
 * it, so a browser that supports WebAuthn — which every browser these specs
 * drive does — shows the disclosure rather than the form. Idempotent, so a
 * caller that is already looking at the form can call it anyway.
 */
export async function openEmailSignIn(page: Page): Promise<void> {
  // Wait for the screen itself before asking what is on it. Probing the
  // disclosure while the portal is still mounting reports "not visible", the
  // click is skipped, and the wait that follows is for a field still folded
  // away — which is a ten-second timeout rather than a useful failure.
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible({ timeout: 15_000 });
  const disclosure = page.getByRole("button", { name: "Sign in with an email link", exact: true });
  if (await disclosure.isVisible().catch(() => false)) await disclosure.click();
  await expect(page.getByLabel("Work email")).toBeVisible({ timeout: 10_000 });
}

/**
 * Opens the signed-in identity's own record, the way a member reaches it.
 *
 * "My profile" is no longer a page of its own: it navigates to
 * `#/users/<own id>`, the same record staff open about anybody. The id is not
 * something a spec knows, so the menu item is what these specs follow — which
 * is also the link issue #41 was about: the separate `#/profile` page is gone,
 * and its settings are offered on the reader's own record instead.
 */
export async function openMyProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My profile" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/users\/[^/?#]+$/, { timeout: 15_000 });
}

/**
 * Takes the "Edit profile" command on the record currently open.
 *
 * A record never arrives in edit mode, not even your own (#47): editing is an
 * action somebody takes from the record's own actions menu, so every spec
 * that changes a profile reaches the fields the way a reader does.
 */
export async function openProfileEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Record actions" }).click();
  await page.getByRole("menuitem", { name: "Edit profile" }).click();
}

/**
 * Opens one of the identity's represented organizations from the same menu.
 *
 * The representatives roster lives on the organization's own page, so this is
 * how a member reaches their coworkers.
 */
export async function openMyOrganization(page: Page, organizationName: string): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: organizationName }).click();
  await expect(page).toHaveURL(/\/portal\/#\/organizations\/[^/?#]+$/, { timeout: 15_000 });
}

/** Establishes a real portal session through the same mailbox capability used by users. */
export async function signInToPortal(page: Page, email: string): Promise<void> {
  // Model independent users arriving from independent clients. The complete
  // serial suite otherwise funnels every sign-in through Wrangler's one local
  // address and exhausts the production-equivalent per-IP limiter.
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  await page.goto("/portal/");
  await openEmailSignIn(page);
  await page.getByLabel("Work email").fill(email);
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
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/portal\/#\/(?!verify(?:$|[/?]))[^?#]+/, { timeout: 15_000 });
}
