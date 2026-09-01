import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Opens what a data-table row points at, through the row's own named control.
 *
 * A row that activates something carries one focusable, named button stretched
 * across the row — there is no per-row "Details" button any more. The row's
 * cell contents are painted above that button, so a pointer click lands on
 * whichever cell sits under it. The spec therefore activates the control the
 * way the keyboard does, which is the contract the markup promises, and still
 * asserts the exact accessible name the row is required to expose.
 */
export async function openRow(row: Locator, actionName: string): Promise<void> {
  const control = row.getByRole("button", { name: actionName, exact: true });
  await expect(control).toBeVisible();
  await control.focus();
  await control.press("Enter");
}

/**
 * The row's own control for one action, whichever form the row gave it.
 *
 * A lone action is an inline button whose accessible name is the action and
 * the row's subject — "Archive, Announcements" — because ten rows of "Archive"
 * would otherwise be ten controls sharing one name. So the match is anchored
 * at the action and stops at the comma the component joins with, rather than
 * being exact.
 */
function inlineRowAction(row: Locator, actionName: string): Locator {
  const escaped = actionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return row.getByRole("button", { name: new RegExp(`^${escaped}(,|$)`) });
}

/**
 * Performs one of a row's actions, whichever way the row is offering it.
 *
 * `RowActions` shows a lone action as a button and collapses two or more into
 * a `…` menu, so how you reach "Archive" depends on what else that row can do
 * at that moment — the event-invitation rows offer resend, revoke, or both,
 * depending on the invitation's state. A spec that hard-codes the menu breaks
 * the day a row loses its second action, and one that hard-codes the button
 * breaks the day it gains one. Both are the same intent: do this to this row.
 */
export async function runRowAction(page: Page, row: Locator, actionName: string): Promise<void> {
  const inline = inlineRowAction(row, actionName);
  if ((await inline.count()) > 0) {
    await expect(inline).toBeEnabled();
    await inline.click();
    return;
  }

  const menu = row.getByRole("button", { name: /^Actions for / });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole("menuitem", { name: actionName, exact: true }).click();
}

/** Whether a row shows an action but refuses it, inline or in its menu. */
export async function rowActionIsDisabled(page: Page, row: Locator, actionName: string): Promise<boolean> {
  const inline = inlineRowAction(row, actionName);
  if ((await inline.count()) > 0) return inline.isDisabled();

  await row.getByRole("button", { name: /^Actions for / }).click();
  const item = page.getByRole("menuitem", { name: actionName, exact: true });
  const disabled = await item.isDisabled();
  await page.keyboard.press("Escape");
  return disabled;
}
