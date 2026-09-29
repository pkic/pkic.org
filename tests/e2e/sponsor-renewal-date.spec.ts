import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

// Midnight UTC used to display as the preceding day in this browser zone.
test.use({ timezoneId: "America/New_York", locale: "en-US" });

test("sponsor renewal keeps the selected calendar day after saving and reloading", async ({ page }, testInfo) => {
  const contactName = `Renewal Contact ${Date.now()}`;
  await signInAsE2eStaff(page, e2eAdminEmail("sponsor-workspace"));
  await page.goto("/portal/#/sponsors");
  await page.getByRole("button", { name: "Create sponsorship" }).click();
  const form = page.getByRole("form", { name: "Create sponsorship" });
  await form.getByLabel("Type").selectOption("event");
  await form.getByRole("combobox", { name: "Event" }).fill("Post-Quantum");
  await form
    .getByRole("option", { name: /Post-Quantum Cryptography Conference/ })
    .first()
    .click();
  await form.getByLabel("Contact name").fill(contactName);
  await form.getByLabel("Contact email").fill(`renewal-${Date.now()}@example.test`);
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Sponsorship created", { exact: true })).toBeVisible();
  await page.getByRole("row").filter({ hasText: contactName }).click();
  const companyUrl = page.url();
  await page
    .getByRole("link", { name: /^Open / })
    .first()
    .click();
  const detail = page.getByRole("region", { name: contactName });
  await detail.getByRole("button", { name: "Sponsorship actions" }).click();
  await page.getByRole("menuitem", { name: "Edit record…" }).click();
  await detail.getByLabel("Renewal date").fill("2027-01-01");
  await detail.getByRole("button", { name: "Save", exact: true }).click();
  await expect(detail.getByText("Renews Jan 1, 2027", { exact: true })).toBeVisible();
  await page.reload();
  await expect(detail.getByText("Renews Jan 1, 2027", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("Sponsorship record").getByText("Jan 1, 2027", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("renewal-detail.png"), fullPage: true });
  await detail.getByRole("button", { name: "Sponsorship actions" }).click();
  await page.getByRole("menuitem", { name: "Edit record…" }).click();
  await expect(detail.getByLabel("Renewal date")).toHaveValue("2027-01-01");
  await page.goto(companyUrl);
  await expect(page.getByRole("cell", { name: "Jan 1, 2027", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("renewal-company.png"), fullPage: true });
});
