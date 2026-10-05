import type { Page } from "@playwright/test";

export async function runAgendaAction(page: Page, action: string): Promise<void> {
  await page.getByRole("button", { name: "Actions for Agenda", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
