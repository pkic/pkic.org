/** @covers groups.8.4 */
import { expect, test, type Locator } from "@playwright/test";
import { groupCreateSchema, groupResponseSchema } from "../../assets/shared/schemas/groups";
import { organizationCreateSchema } from "../../assets/shared/schemas/organization-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openRow } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";

async function expectCount(region: Locator, label: string, count: number) {
  await expect(
    region.getByRole("group", { name: label, exact: true }).getByText(String(count), { exact: true }),
  ).toBeVisible();
}

test("members, mailing lists, and analytics show distinct organization representation", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-group-self-service"));
  const stamp = Date.now();
  const emails = [`forms-${stamp}@example.test`, `users-${stamp}@example.test`];
  const organization = await page.request.post("/api/v1/organizations", {
    data: organizationCreateSchema.parse({
      name: `Representation organization ${stamp}`,
      membershipCategory: "F",
      memberSince: "2026-01-15",
      identities: emails.map((email, index) => ({
        name: `Representation user ${index + 1}`,
        email,
        jobTitle: "Delegate",
      })),
      activationReason: "Synthetic organization for representation verification",
    }),
  });
  expect(organization.status(), await organization.text()).toBe(201);
  const created = await page.request.post("/api/v1/groups", {
    data: groupCreateSchema.parse({ typeKey: "working_group", name: `Forms and users ${stamp}` }),
  });
  expect(created.status()).toBe(201);
  const { group } = groupResponseSchema.parse(await created.json());
  await page.goto(`/portal/#/groups/${group.id}/members`);
  const representation = page.getByRole("region", { name: "Representation", exact: true });
  await expectCount(representation, "Organizations", 0);
  for (const email of emails) {
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const form = page.getByRole("region", { name: "Add a person" });
    await form.getByLabel("Search for a user").fill(email);
    await page
      .getByRole("group", { name: "Matching users" })
      .getByRole("button", { name: new RegExp(email) })
      .click();
    await form.getByRole("button", { name: "Add to group" }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${group.id}/members$`));
  }
  await expectCount(representation, "People", 2);
  await expectCount(representation, "Organizations", 1);
  await page.screenshot({ path: test.info().outputPath("member-representation.png"), fullPage: true });
  await page.getByPlaceholder("Search name, email, organization, or category…").fill("no matching user");
  await page.getByRole("button", { name: "Search members", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Representation user" })).toHaveCount(0);
  await expectCount(representation, "People", 2);
  await expect(page.getByText("No members to show", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  const participation = page.getByRole("region", { name: "Participation", exact: true });
  await expectCount(participation, "People", 2);
  await expectCount(participation, "Organizations", 1);
  await expectCount(participation, "Memberships", 2);
  await page.screenshot({ path: test.info().outputPath("analytics-representation.png"), fullPage: true });

  await page.goto(`/portal/#/groups/${group.id}/mailing-lists`);
  await page.getByRole("button", { name: "Add mailing list" }).click();
  const form = page.locator("form").filter({ hasText: "New group mailing list" });
  const label = `Organization forms ${stamp}`;
  await form.getByLabel("Email", { exact: false }).fill(`representation-${stamp}@lists.example.test`);
  await form.getByLabel("Label", { exact: false }).fill(label);
  await form.getByLabel("Purpose", { exact: true }).selectOption("group");
  await form.getByLabel("Default subscription", { exact: true }).selectOption("group_members");
  await form.getByRole("button", { name: "Create mailing list" }).click();
  await openRow(page.getByRole("row").filter({ hasText: label }), `Open ${label}`);
  await expectCount(representation, "People", 2);
  await expectCount(representation, "Organizations", 1);
  await page.getByPlaceholder("Search subscribers…").fill("no matching user");
  await page.getByRole("button", { name: "Search mailing-list subscribers", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Representation user" })).toHaveCount(0);
  await expectCount(representation, "Organizations", 1);
  await expect(page.getByText("No subscribers to show", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("mailing-representation.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(representation).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mailing-representation-mobile.png"), fullPage: true });
});
