/**
 * Membership → Members: the consortium's own roll, and granting one.
 *
 * Membership is a grant on somebody who already exists rather than a record
 * created from nothing. The API could always do it; nothing in the portal
 * could, so an individual member — the H5/H6/H7 categories, who have no
 * organization behind them — could not be added without curl. That is issue
 * #24, and this walks the whole of it: a person with an account and no
 * membership, the roll that does not list them, the grant, and the roll that
 * does.
 * @covers system.12.11
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { runRowAction } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";

test("staff grant an individual membership from the members roll", async ({ page }) => {
  /*
   * Somebody with an account and no membership, which is the only interesting
   * starting state for a grant: the seeded worker-pool identities are bare
   * `users` rows, so this one is a person the consortium knows and has never
   * admitted. It is never signed in as.
   */
  const email = e2eAdminEmail("portal-members-roll-target");

  await signInToPortal(page, e2eAdminEmail("portal-members-roll"));

  await page.goto("/portal/#/members");
  await expect(page.getByRole("heading", { name: "Members", level: 2 })).toBeVisible();

  const search = page.getByPlaceholder("organization or name");
  await search.fill(email);
  await search.press("Enter");
  await expect(page.locator("tr").filter({ hasText: email })).toHaveCount(0);

  // The grant is a page of its own, not a panel above the roll: it has its
  // own address, so a reload keeps it and Back closes it.
  await page.getByRole("button", { name: "Grant membership" }).click();
  await expect(page).toHaveURL(/#\/members\/grant$/);
  const form = page.getByRole("region", { name: "Grant a membership" });
  await expect(form).toBeVisible();
  await expect(page.getByRole("table", { name: "Members" })).toHaveCount(0);

  // The person picker is a debounced server search, the same one every other
  // "choose an existing user" surface uses.
  await form.getByPlaceholder("email or name").fill(email);
  await form.getByRole("button", { name: email }).click();

  // Only the individual half of the vocabulary is offered: an org-tied
  // category belongs to an organization's Member aggregate, not here.
  // Located by role and accessible name: `Field` composes the name from the
  // label, its required mark and the "(required)" suffix, so the label text a
  // `getByLabel` matches against is not the name a reader is given.
  const category = form.getByRole("combobox", { name: "Category (required)" });
  await expect(category.locator("option")).toHaveText([/\(H5\)$/, /\(H6\)$/, /\(H7\)$/]);
  await category.selectOption("H6");
  await form
    .getByRole("textbox", { name: "Activation reason (required)" })
    .fill("E2E: individual membership granted from the roll");

  const granted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/members/capacities" && response.request().method() === "POST",
  );
  await form.getByRole("button", { name: "Grant membership" }).click();
  expect((await granted).status()).toBe(201);

  /*
   * And the roll now carries them. A row is a membership rather than a
   * person: this one is an individual's, so it reads as "Individual" instead
   * of naming an organization and a representative count. A person with no
   * name is listed by their address, which is what staff can search on.
   */
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 15_000 });
  // The kind is a mark rather than a word, so it is read by its name.
  await expect(row.getByRole("img", { name: "Individual" })).toBeVisible();
  await expect(row).toContainText("H6");

  /*
   * A membership is not write-once: staff can change what it is held under
   * and record that it ended. Both are the membership's own commands, on the
   * row that holds it — the "…" every other list row carries.
   */
  await runRowAction(page, row, "Edit membership");
  await expect(page).toHaveURL(/#\/members\/[^/]+$/);
  const editor = page.getByRole("region", { name: "Edit membership" });
  const editorCategory = editor.getByRole("combobox", { name: "Category (required)" });
  // Only the categories this kind of membership can hold: an individual
  // cannot take an org-tied code, and the server refuses the mismatch.
  await expect(editorCategory.locator("option")).toHaveText([/\(H5\)$/, /\(H6\)$/, /\(H7\)$/]);
  await editorCategory.selectOption("H7");
  const saved = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/members\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await editor.getByRole("button", { name: "Save membership" }).click();
  expect((await saved).status()).toBe(200);

  const updated = page.locator("tr").filter({ hasText: email });
  await expect(updated).toContainText("H7", { timeout: 15_000 });

  // Ending it is a standing, not a deletion: the row stays, and says so.
  const ended = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/members\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH",
  );
  await runRowAction(page, updated, "End membership");
  await acceptConfirmDialog(page, "End membership");
  expect((await ended).status()).toBe(200);
  await expect(updated).toContainText("Inactive", { timeout: 15_000 });
});
