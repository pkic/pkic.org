import { expect, type Page } from "@playwright/test";

/**
 * Attaches a resident-key authenticator that reports a verified user, matching
 * the `residentKey: "required"` / `userVerification: "required"` policy the
 * registration options ask for.
 */
export async function attachVirtualAuthenticator(page: Page, transport: "internal" | "usb"): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

export async function openOwnUserRecord(page: Page): Promise<void> {
  await page.goto("/portal/#/users/current");
  await expect(page.getByRole("heading", { name: "Passkeys", exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Opens the add form: the panel's menu leads to a dialog holding the device name and its button. */
export async function openAddPasskey(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Passkeys actions" }).click();
  await page.getByRole("menuitem", { name: "Add a passkey" }).click();
  await expect(page.getByRole("dialog", { name: "Add a passkey" })).toBeVisible();
}

export async function enrollPasskey(page: Page, deviceName: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Add a passkey" });
  await dialog.getByLabel("Device name (optional)").fill(deviceName);
  await dialog.getByRole("button", { name: "Add a passkey", exact: true }).click();
  await expect(page.getByText("Passkey added")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("listitem").filter({ hasText: deviceName })).toBeVisible();
}
