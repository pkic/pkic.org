/**
 * Performing a row's action from a component test, whichever way the row
 * offers it.
 *
 * `RowActions` shows a lone action as a button and collapses two or more into
 * a `…` menu, so how a test reaches "Revoke invitation" depends on what else
 * that row can do at that moment — an invitation offers resend, revoke, or
 * both, depending on its state. A test that hard-codes the menu breaks the day
 * a row loses its second action, and one that hard-codes the button breaks the
 * day it gains one. Both are the same intent: do this to this row. The browser
 * specs resolve it the same way, in `tests/e2e/helpers/data-table.ts`.
 *
 * Everything here selects on the accessible name, built by the component's own
 * name helpers, because that name is the contract: whichever control a row
 * ends up with, it announces the row's subject, so a page of ten "Remove"
 * controls is still ten distinguishable controls.
 */

import { act } from "preact/test-utils";
import { rowActionName, rowActionsMenuName } from "../../../assets/ts/ui/RowActions";

function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

/** The inline button a row shows when `action` is the only thing it can do. */
export function inlineRowAction(root: ParentNode, subject: string, action: string): HTMLButtonElement | null {
  return buttonLabelled(root, rowActionName(action, subject));
}

/** The `…` trigger a row shows once it has two or more actions. */
export function rowMenuTrigger(root: ParentNode, subject: string): HTMLButtonElement | null {
  return buttonLabelled(root, rowActionsMenuName(subject));
}

/**
 * The accessible name of every row control on the page, in document order —
 * inline buttons and menu triggers alike, and nothing else the row renders.
 *
 * This is how a test asserts that a reader is offered no row commands at all,
 * and that the commands they are offered name their rows. It selects on the
 * component's own container class because "controls belonging to a row" is not
 * something a role or a name can express; the menu's items carry no
 * `aria-label`, so an open menu does not pollute the list.
 */
export function rowActionControlNames(root: ParentNode): string[] {
  return [...root.querySelectorAll(".pk-row-actions button[aria-label]")].map(
    (control) => control.getAttribute("aria-label") ?? "",
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * The row's control, waiting for the row to arrive.
 *
 * A list screen fetches its rows, so the row a test wants to act on often
 * lands a tick or two after the render that mounted the table. Settling here
 * keeps that scheduling detail out of every caller; a control that never
 * appears still fails, by name, rather than as a null dereference.
 */
async function waitForRowControl(root: ParentNode, subject: string, action: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (inlineRowAction(root, subject, action) ?? rowMenuTrigger(root, subject)) return;
    await settle();
  }
  throw new Error(`no row control for "${subject}" offers "${action}"`);
}

/** Opens the row's menu. Only a row with two or more actions has one. */
export async function openRowMenu(root: ParentNode, subject: string): Promise<void> {
  const trigger = rowMenuTrigger(root, subject);
  if (!trigger) throw new Error(`no row menu is named "${rowActionsMenuName(subject)}"`);
  await act(async () => trigger.click());
}

/** The menu item reading exactly `label`, in whichever menu is open. */
export function menuItemNamed(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === label) ??
    null
  );
}

/** Performs one of a row's actions, inline where it is inline, through the menu where it is not. */
export async function runRowAction(root: ParentNode, subject: string, action: string): Promise<void> {
  await waitForRowControl(root, subject, action);
  const inline = inlineRowAction(root, subject, action);
  if (inline) {
    await act(async () => inline.click());
    return;
  }

  await openRowMenu(root, subject);
  const item = menuItemNamed(root, action);
  if (!item) throw new Error(`the row for "${subject}" offers no "${action}"`);
  await act(async () => item.click());
}

/**
 * Whether the row shows `action` but refuses it — a disabled inline button, or
 * a disabled item in the row's menu, which the component renders disabled
 * rather than hiding so the reader can see the action exists.
 */
export async function rowActionIsDisabled(root: ParentNode, subject: string, action: string): Promise<boolean> {
  await waitForRowControl(root, subject, action);
  const inline = inlineRowAction(root, subject, action);
  if (inline) return inline.disabled;

  await openRowMenu(root, subject);
  const item = menuItemNamed(root, action);
  if (!item) throw new Error(`the row for "${subject}" offers no "${action}"`);
  return item.disabled;
}
