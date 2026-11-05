import { expect, test } from "@playwright/test";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import {
  groupEventRegistrationSettingsResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
} from "../../assets/shared/schemas/group-events";
import { registrationSubmissionResponseSchema } from "../../assets/shared/schemas/registration";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { approveMemberThroughReview } from "./helpers/membership";
import { createRegistrationEvent } from "./helpers/participation-state-fixture";
import { signInToPortal } from "./helpers/portal-auth";

test("a signed-in group member completes required registration through the portal form", async ({ page }, info) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const fixture = await createRegistrationEvent(page, "required-group-registration");
  const detail = await page.request.get(`/api/v1/events/${fixture.slug}`);
  expect(detail.status()).toBe(200);
  const event = eventDetailResponseSchema.parse(await detail.json()).event;
  if (!("ownerGroupId" in event) || !event.ownerGroupId) throw new Error("Fixture event has no owner group");
  const settingsPath = `/api/v1/groups/${event.ownerGroupId}/events/${event.id}/registration-settings`;
  const settings = groupEventRegistrationSettingsResponseSchema.parse(
    await (await page.request.get(settingsPath)).json(),
  );
  const updated = await page.request.put(settingsPath, {
    data: groupEventRegistrationSettingsUpdateSchema.parse({
      expectedUpdatedAt: settings.eventUpdatedAt,
      registrationPolicy: "required",
    }),
  });
  expect(updated.status(), await updated.text()).toBe(200);

  const email = `attendee@group-${crypto.randomUUID()}.test`;
  await approveMemberThroughReview(page, {
    email,
    name: "Group Attendee",
    organizationName: `Synthetic Group ${crypto.randomUUID()}`,
  });
  await page.context().clearCookies();
  await signInToPortal(page, email);
  const joined = await page.request.post(`/api/v1/groups/${event.ownerGroupId}/join`, {
    data: { capacitySelection: { mode: "all_eligible", confirmed: true } },
  });
  expect(joined.status(), await joined.text()).toBe(200);
  await page.goto(`/portal/#/events/${fixture.slug}/register`);
  const form = page.getByRole("region", { name: "Event registration", exact: true });
  await expect(form).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: "In person — Workshop day", exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: "I agree to the privacy policy", exact: true }).check();
  await page.getByRole("checkbox", { name: "I agree to the code of conduct", exact: true }).check();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/v1/events/${fixture.slug}/registrations`,
  );
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(200);
  expect(registrationSubmissionResponseSchema.parse(await response.json()).status).toBe("registered");
  await expect(page).toHaveURL(new RegExp(`/events/${fixture.slug}/ticket$`));
  await expect(
    page
      .frameLocator('iframe[title^="Your badge for "]')
      .getByRole("button", { name: "Enlarge check-in code", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("group-registration-ticket.png"), fullPage: true });
});
