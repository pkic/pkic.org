/**
 * Drives a list's column menu the way a reader does.
 *
 * A column's filter lives behind the `…` trigger in its head, named
 * "<Header> column options"; the choices are `menuitemradio` items with the
 * one in force checked. These helpers resolve the trigger through that name
 * — which fails exactly when the labelling is broken — open the menu, and
 * pick an option by its visible label, so a test asserts the query the
 * server receives rather than the shape of a select that no longer exists.
 */
import { act } from "preact/test-utils";

function labelOf(item: Element): string {
  return item.textContent!.replace(/^✓?\s*/, "").trim();
}

/** Opens a column's menu and returns its popup. */
export function openColumnMenu(container: ParentNode, column: string): HTMLElement {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${column} column options"]`);
  if (!trigger) throw new Error(`no column is named "${column}"`);
  // The trigger toggles, so a menu a test already has open stays open.
  if (trigger.getAttribute("aria-expanded") !== "true") void act(() => trigger.click());
  const popup = trigger.parentElement?.querySelector<HTMLElement>('[role="menu"]');
  if (!popup) throw new Error(`the ${column} column menu did not open`);
  return popup;
}

/** The labels of the filter choices a column's menu offers, in order. */
export function columnFilterOptions(container: ParentNode, column: string): string[] {
  const popup = openColumnMenu(container, column);
  return [...popup.querySelectorAll('[role="menuitemradio"]')]
    .filter((item) => !labelOf(item).startsWith("Sort "))
    .map(labelOf);
}

/** Narrows a column to one of its filter choices, by the choice's label. */
export async function chooseColumnFilter(container: ParentNode, column: string, option: string): Promise<void> {
  const popup = openColumnMenu(container, column);
  const item = [...popup.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (candidate) => labelOf(candidate) === option,
  );
  if (!item) throw new Error(`the ${column} column offers no "${option}" choice`);
  await act(async () => {
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What a column's head says it is narrowed to, or undefined when it is open. */
export function columnFilterSummary(container: ParentNode, column: string): string | undefined {
  const head = [...container.querySelectorAll("th")].find((th) => th.textContent!.includes(column));
  return head?.querySelector(".pk-table__head-filter")?.textContent ?? undefined;
}
