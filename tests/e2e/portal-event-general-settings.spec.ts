/** @covers event.3.1 */
import { test, expect } from "@playwright/test";
import { groupEventSettingsUpdateSchema } from "../../assets/shared/schemas/group-events";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

test.use({ timezoneId: "America/Los_Angeles" });

test("event settings require editing and keep the configured wall clock after saving and reloading", async ({
  page,
}) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const slug = "e2e-standalone-settings";
  await page.goto(`/portal/#/events/${slug}/settings/general`);
  await expect(page.getByRole("heading", { name: "Event details", exact: true })).toBeVisible();
  const details = page.getByRole("region", { name: "Event details", exact: true });
  await expect(details.locator("input,select,textarea")).toHaveCount(0);
  async function edit() {
    await details.getByRole("button", { name: "Event actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit event", exact: true }).click();
  }
  await edit();
  const originalName = await page.getByLabel("Event name").inputValue();
  await expect(page.getByLabel("Start date")).toHaveValue("2027-06-10T09:00");
  await page.getByLabel("Event name").fill("Discarded name");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(details).toContainText(originalName);
  await edit();
  await expect(page.getByLabel("Event name")).toHaveValue(originalName);
  await page.getByLabel("Event name").fill("Saved event settings");
  const saved = page.waitForResponse(
    (response) =>
      /\/api\/v1\/groups\/[^/]+\/events\/[^/]+\/settings$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  expect(groupEventSettingsUpdateSchema.parse(response.request().postDataJSON()).startsAt).toBe(
    "2027-06-10T07:00:00.000Z",
  );
  await expect(details.locator("input,select,textarea")).toHaveCount(0);
  await page.reload();
  await expect(details).toContainText("Saved event settings");
  await edit();
  await expect(page.getByLabel("Start date")).toHaveValue("2027-06-10T09:00");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
