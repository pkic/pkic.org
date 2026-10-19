import type { Locator, Page } from "@playwright/test";

/**
 * The session editor dialog. Like the session details it replaces, it takes the session title as
 * its name, so it is told apart by its own close control.
 */
export function sessionEditor(page: Page, title: string): Locator {
  return page
    .getByRole("dialog", { name: title, exact: true })
    .filter({ has: page.getByRole("button", { name: "Close session editor", exact: true }) });
}

export async function runAgendaAction(page: Page, action: string): Promise<void> {
  await page.getByRole("button", { name: "Actions for Agenda", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
