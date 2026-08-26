import { expect, test } from "@playwright/test";
import { groupEventsListResponseSchema } from "../../assets/shared/schemas/group-events";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

test("a portal manager creates and edits a group-owned standalone event", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-event"));
  await page.goto(`/portal/#/groups/${GROUP_ID}/events`);
  await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();

  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const eventName = `Portal architecture workshop ${unique}`;
  const eventSlug = `portal-architecture-workshop-${unique}`;

  await page.getByRole("button", { name: "Create event" }).click();
  await page.getByLabel("Event name").fill(eventName);
  await expect(page.getByLabel("Slug")).toHaveValue(eventSlug);
  await page.getByLabel("Start date").fill("2027-06-10T09:00");
  await page.getByLabel("End date").fill("2027-06-10T17:00");
  await page.getByLabel("Timezone").fill("Europe/Amsterdam");
  await page.getByLabel("Event profile").selectOption("workshop");
  await page.getByLabel("Location").fill("Amsterdam and online");
  await page.getByLabel("Event resource URL").fill("https://example.test/portal-workshop");
  await page.getByRole("button", { name: "Add profile link" }).click();
  await page.getByRole("button", { name: "Create event", exact: true }).click();

  const row = page.getByRole("row").filter({ hasText: eventName });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("Amsterdam and online", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="https://example.test/portal-workshop"]')).toHaveAttribute(
    "href",
    "https://example.test/portal-workshop",
  );
  await expect(page.getByRole("link", { name: "Open registration" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit event" }).click();
  const editor = page.getByRole("heading", { name: "Edit event" }).locator("..");
  await editor.getByLabel("Location").fill("Rotterdam and online");
  await editor.getByRole("button", { name: "Save event" }).click();
  await expect(
    page.getByRole("region", { name: `${eventName} details` }).getByText("Rotterdam and online", { exact: true }),
  ).toBeVisible();

  const stored = await page.evaluate(
    async ({ groupId, query }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/events?q=${encodeURIComponent(query)}&limit=10`, {
        credentials: "same-origin",
      });
      return { status: response.status, body: await response.json() };
    },
    { groupId: GROUP_ID, query: eventSlug },
  );
  expect(stored.status, JSON.stringify(stored.body)).toBe(200);
  expect(groupEventsListResponseSchema.parse(stored.body).events).toContainEqual(
    expect.objectContaining({
      slug: eventSlug,
      ownerGroupId: GROUP_ID,
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      location: "Rotterdam and online",
    }),
  );
});
