import type { Page } from "@playwright/test";

/**
 * Confirm the portal's in-page ConfirmDialog by clicking its named action
 * button. Replaces the old `page.on("dialog", ...)` auto-accept that handled
 * native `window.confirm`, which the portal no longer uses.
 */
export async function acceptConfirmDialog(page: Page, confirmLabel: string | RegExp): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await dialog.waitFor({ state: "detached" });
}

/** Dismiss the portal's in-page ConfirmDialog without confirming. */
export async function cancelConfirmDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
}
