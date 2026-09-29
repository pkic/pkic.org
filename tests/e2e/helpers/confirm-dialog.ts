import { type Locator, type Page } from "@playwright/test";

/**
 * The portal's in-page ConfirmDialog, of either kind.
 *
 * `ConfirmDialogHost` renders the design system's `Dialog`, which carries
 * `role="alertdialog"` for a destructive decision and leaves the native
 * `<dialog>` role — `dialog` — in place for an affirmative one such as
 * "Approve & run onboarding". Only one confirmation is ever open at a time,
 * so asking for either role names the same single element while keeping the
 * distinction the markup deliberately makes.
 */
export function confirmDialog(page: Page): Locator {
  return page.getByRole("alertdialog").or(page.getByRole("dialog"));
}

/** Confirm the open dialog by clicking its named action button. */
export async function acceptConfirmDialog(page: Page, confirmLabel: string | RegExp): Promise<void> {
  const dialog = confirmDialog(page);
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await dialog.waitFor({ state: "detached" });
}

/** Dismiss the open dialog without confirming. */
export async function cancelConfirmDialog(page: Page): Promise<void> {
  const dialog = confirmDialog(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
}
