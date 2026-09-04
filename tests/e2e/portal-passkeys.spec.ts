/**
 * The passkey capability, end to end through a real WebAuthn ceremony.
 *
 * Chromium's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`)
 * stands in for Touch ID or a security key, so registration, removal, and
 * passkey sign-in run the same `navigator.credentials` calls a user's device
 * would. Nothing here is stubbed on the application side: the browser signs a
 * real assertion and the Worker verifies it against `WEBAUTHN_ORIGIN`.
 *
 * This needs the suite's origin to be `localhost`. WebAuthn rejects an IP
 * literal as a relying-party id, so a run served from 127.0.0.1 fails in the
 * browser before the application is reached — see scripts/e2e-start.sh.
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { runRowAction } from "./helpers/data-table";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

const PASSKEY_EMAIL = e2eAdminEmail("portal-passkeys");
const DEVICE_NAME = "E2E virtual authenticator";

/**
 * Attaches a resident-key authenticator that reports a verified user, matching
 * the `residentKey: "required"` / `userVerification: "required"` policy the
 * registration options ask for.
 */
async function attachVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function openAccountSettings(page: Page): Promise<void> {
  await page.goto("/portal/#/account");
  await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible({ timeout: 15_000 });
}

async function enrollPasskey(page: Page, deviceName: string): Promise<void> {
  await page.getByLabel("Device name (optional)").fill(deviceName);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByText("Passkey added")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("cell", { name: deviceName, exact: true })).toBeVisible();
}

test("a passkey can be registered, used to sign in, and removed", async ({ page }) => {
  await attachVirtualAuthenticator(page);
  await signInToPortal(page, PASSKEY_EMAIL);
  await openAccountSettings(page);

  await enrollPasskey(page, DEVICE_NAME);
  // A freshly registered credential has never been asserted.
  await expect(page.getByText("Never")).toBeVisible();

  // ── Sign in with the passkey alone ───────────────────────────────────────
  // Dropping the cookies leaves the authenticator holding the credential but
  // the browser holding no session, which is the state a returning user is in.
  await page.context().clearCookies();
  await page.goto("/portal/");
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByLabel("Email")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });

  // The session is a real one, not just a dismissed login screen.
  await openAccountSettings(page);
  await expect(page.getByRole("cell", { name: DEVICE_NAME, exact: true })).toBeVisible();
  // The assertion that just signed the user in is recorded against the credential.
  await expect(page.getByText("Never")).toHaveCount(0);

  // ── Removal ──────────────────────────────────────────────────────────────
  const row = page.getByRole("row").filter({ hasText: DEVICE_NAME });
  await runRowAction(page, row, "Remove");
  await acceptConfirmDialog(page, "Remove passkey");
  await expect(page.getByText("Passkey removed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("cell", { name: DEVICE_NAME, exact: true })).toHaveCount(0);
});
