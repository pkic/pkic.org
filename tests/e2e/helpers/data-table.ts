import { expect, type Locator } from "@playwright/test";

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
