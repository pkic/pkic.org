import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A new account has no name yet. The signed-in summary in registration and
 * the membership application offers the shared editor for it; this fills it
 * in when the summary inside `scope` still asks for a name.
 */
export async function addMissingName(
  page: Page,
  scope: Locator,
  names: { firstName?: string; lastName?: string } = {},
): Promise<void> {
  if (!(await scope.getByText("Add your name", { exact: true }).count())) return;
  await scope.getByRole("button", { name: "Edit personal details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit my details", exact: true });
  await dialog.getByRole("textbox", { name: /^First name/ }).fill(names.firstName ?? "Event");
  await dialog.getByRole("textbox", { name: /^Last name/ }).fill(names.lastName ?? "Attendee");
  await dialog.getByRole("button", { name: "Save my details", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(scope.getByText("Add your name", { exact: true })).toHaveCount(0);
}

/** An individual application takes its bio from the representation; this adds one through its editor. */
export async function addRepresentationBio(page: Page, scope: Locator, bio: string): Promise<void> {
  await scope.getByRole("button", { name: "Change representation", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Change representation", exact: true });
  await picker.getByRole("button", { name: "Edit representation", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit representation", exact: true });
  await editor.getByLabel("About you", { exact: false }).fill(bio);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await picker.getByRole("button", { name: "Use representation", exact: true }).click();
  await expect(picker).not.toBeVisible();
}
