/** @covers groups.8.2 */
import { test, expect } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test("group configuration requires editing and preserves only saved changes", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-group-self-service"));
  await page.goto("/portal/#/groups/new");
  const create = page.getByRole("region", { name: "Create a group", exact: true });
  const name = `Settings review ${Date.now()}`;
  await create.getByLabel("Group type").fill("Working");
  await create.getByRole("option", { name: /Working Groups/ }).click();
  await create.getByLabel(/^Name/).fill(name);
  await create.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page).toHaveURL(/#\/groups\/[^/]+\/settings$/);
  const general = page.getByRole("tabpanel");
  await expect(general.locator("input,select,textarea")).toHaveCount(0);
  async function edit(label: string) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit settings", exact: true }).click();
  }
  await edit("Group settings actions");
  await general.getByLabel(/^Name/).fill("Discard this name");
  await general.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(general.locator("input,select,textarea")).toHaveCount(0);
  await expect(general).toContainText(name);
  await edit("Group settings actions");
  await expect(general.getByLabel(/^Name/)).toHaveValue(name);
  await general.getByLabel(/^Name/).fill("");
  await general.getByRole("button", { name: "Save group settings", exact: true }).click();
  await expect(general.getByLabel(/^Name/)).toHaveAttribute("aria-invalid", "true");
  await general.getByLabel(/^Name/).fill(`${name} saved`);
  await general.getByRole("button", { name: "Save group settings", exact: true }).click();
  await expect(general.locator("input,select,textarea")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: `${name} saved`, exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Eligibility", exact: true }).click();
  const eligibility = page.getByRole("tabpanel");
  await expect(eligibility.getByRole("table")).toBeVisible();
  await expect(eligibility.getByRole("checkbox")).toHaveCount(0);
  await edit("Eligibility actions");
  const category = eligibility.getByRole("checkbox", {
    name: "Certification Authorities and Trust Service Providers may join",
    exact: true,
  });
  const initial = await category.isChecked();
  await category.setChecked(!initial);
  await eligibility.getByRole("button", { name: "Cancel", exact: true }).click();
  await edit("Eligibility actions");
  await expect(category).toBeChecked({ checked: initial });
  await category.setChecked(!initial);
  await eligibility.getByRole("button", { name: "Save category rules", exact: true }).click();
  await expect(eligibility.getByRole("checkbox")).toHaveCount(0);
  await page.reload();
  await edit("Eligibility actions");
  await expect(category).toBeChecked({ checked: !initial });
  await eligibility.getByRole("button", { name: "Cancel", exact: true }).click();
});
