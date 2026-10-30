import { createHash } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { userAuthSessionResponseSchema } from "../../../assets/shared/schemas/user-auth";
import { sessionActingIdentityChoiceRequired } from "../../../assets/shared/session-acting-identity";

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
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  const passkey = page.getByRole("button", { name: "Sign in with a passkey" });
  await expect(signIn.or(passkey)).toBeVisible({ timeout: 15_000 });
  if (await signIn.isVisible()) await signIn.click();
  // Wait for the screen itself before asking what is on it. Probing the
  // disclosure while the portal is still mounting reports "not visible", the
  // click is skipped, and the wait that follows is for a field still folded
  // away — which is a ten-second timeout rather than a useful failure.
  await expect(passkey).toBeVisible({ timeout: 15_000 });
  // The busy "Checking your sign-in…" card shows the same buttons disabled,
  // then loses its status line. Clicking through that settling makes the
  // browser scroll a moved target into view; wait until the card is ready.
  await expect(passkey).toBeEnabled({ timeout: 15_000 });
  const disclosure = page.getByRole("button", { name: "Sign in with an email link", exact: true });
  if (await disclosure.isVisible().catch(() => false)) await disclosure.click();
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 10_000 });
}

/** Opens the signed-in person's own record through the account menu. */
export async function openMyProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "My profile" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/users\/[^/?#]+$/, { timeout: 15_000 });
}

/** Takes "Edit profile" from the record's actions menu, which opens the names editor over the record. */
export async function editMyProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Record actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit profile", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit names", exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens the profile page of one identity the person holds, from that
 * identity's row menu on their record ("Edit profile…"). The identity's job
 * title, biography and links are edited there, not on the record's edit view.
 */
export async function editMyIdentityProfile(page: Page, identityName: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${identityName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit profile…", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/users\/[^/?#]+\/affiliations\/[^/?#]+\/profile$/, {
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: /^Job title for this organization/ })).toBeVisible();
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
export async function signInToPortal(page: Page, email: string, options: { continueAs?: string } = {}): Promise<void> {
  // Model independent users arriving from independent clients. The complete
  // serial suite otherwise funnels every sign-in through Wrangler's one local
  // address and exhausts the production-equivalent per-IP limiter.
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  await page.goto("/portal/");
  await openEmailSignIn(page);
  await page.getByLabel("Email").fill(email);
  const since = await capturedEmailCount();
  // The confirmation follows the server's answer, which a busy server takes longer than an assertion's default to give.
  const requested = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/auth/request-link" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const linkRequest = await requested;
  expect(linkRequest.status(), await linkRequest.text()).toBe(200);
  await expect(page.getByText("you'll receive a sign-in link shortly", { exact: false })).toBeVisible();
  const emailMessage = await waitForCapturedEmail(email, "sign-in link", { since });
  // A user normally opens the email in a new tab. The portal is already
  // mounted here and a hash-only navigation would not rerun its one-time
  // verifier, so leave the document first and open the link as a fresh load.
  // (Reloading after the link instead races the first redemption: the reload
  // cancels its response, the session cookie is lost, and the second
  // redemption of the same token is refused.)
  await page.goto("about:blank");
  const verified = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/auth/verify-link" && response.request().method() === "POST",
  );
  await page.goto(extractEmailUrl(emailMessage, "/portal/"));
  const session = userAuthSessionResponseSchema.parse(await (await verified).json());
  // The login heading remains visible while the hash verifier redeems the
  // capability, so waiting for that text would return before a session exists.
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0, { timeout: 15_000 });
  // A person holding several identities is asked which one to continue as, unless this device remembers a choice.
  const chooser = page.getByRole("heading", { name: "Choose how you take part" });
  let chooseIdentity = false;
  if (sessionActingIdentityChoiceRequired(session)) {
    // Verification can briefly mount the shell before its canonical refresh
    // asks for representation. A visible shell alone is not a settled choice.
    await expect
      .poll(
        async () => {
          if (await chooser.isVisible()) {
            chooseIdentity = true;
            return true;
          }
          if (!(await page.getByRole("button", { name: "Account menu", exact: true }).isVisible())) return false;
          const currentResponse = await page.request.get("/api/v1/auth/session");
          if (currentResponse.status() !== 200) return false;
          const current = userAuthSessionResponseSchema.parse(await currentResponse.json());
          return !sessionActingIdentityChoiceRequired(current);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }
  if (chooseIdentity || (await chooser.isVisible())) {
    const choices = page.getByRole("region", { name: "Choose how you take part" }).getByRole("button");
    // A long identity name wraps inside its choice, on a phone as on a desktop.
    for (const choice of await choices.all())
      expect(await choice.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true);
    // Without a named identity the helper continues personally, as it did when that choice was listed first.
    const personal = choices.filter({ hasText: "Personal" });
    await (
      options.continueAs
        ? choices.filter({ hasText: options.continueAs })
        : (await personal.count()) > 0
          ? personal.first()
          : choices.first()
    ).click();
  }
  await declinePasskeyOffer(page);
  await expect(page).toHaveURL(/\/portal\/#\/(?!verify(?:$|[/?]))[^?#]+/, { timeout: 15_000 });
}

/** Email sign-in can offer passkey enrollment before the shell mounts: follows its visible opt-out. */
export async function declinePasskeyOffer(page: Page): Promise<void> {
  const passkeyOffer = page.getByRole("region", { name: "You're signed in", exact: true });
  await expect(page.locator("#portal-root").or(passkeyOffer).first()).toBeVisible({ timeout: 30_000 });
  if (await passkeyOffer.isVisible())
    await passkeyOffer.getByRole("button", { name: "Continue without a passkey", exact: true }).click();
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 30_000 });
}
