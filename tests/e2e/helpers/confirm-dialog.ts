import { type Locator, type Page } from "@playwright/test";

/**
 * The portal's in-page ConfirmDialog, of either kind.
 *
 * `ConfirmDialogHost` renders the design system's `Dialog`, which carries
 * `role="alertdialog"` for a destructive decision and leaves the native
 * `<dialog>` role — `dialog` — in place for an affirmative one such as
 * "Approve & run onboarding". Scope by title when a confirmation opens over
 * another dialog, so the underlying editor is not mistaken for the confirmation.
 */
export function confirmDialog(page: Page, title?: string | RegExp): Locator {
  const options = { name: title, exact: typeof title === "string" };
  return page.getByRole("alertdialog", options).or(page.getByRole("dialog", options));
}

/** Confirm the open dialog by clicking its named action button. */
export async function acceptConfirmDialog(
  page: Page,
  confirmLabel: string | RegExp,
  title?: string | RegExp,
): Promise<void> {
  const dialog = confirmDialog(page, title);
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await dialog.waitFor({ state: "detached" });
}

/** Dismiss the open dialog without confirming. */
export async function cancelConfirmDialog(page: Page): Promise<void> {
  const dialog = confirmDialog(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
}
