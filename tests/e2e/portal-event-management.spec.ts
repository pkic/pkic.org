/**
 * @covers event.3.1
 */
import { expect, test } from "@playwright/test";
import {
  groupEventDaysResponseSchema,
  groupEventRegistrationSettingsResponseSchema,
  groupEventTermsResponseSchema,
  groupEventsListResponseSchema,
} from "../../assets/shared/schemas/group-events";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openRow } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

test("a portal manager creates and edits a group-owned standalone event", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  await page.goto(`/portal/#/groups/${GROUP_ID}/events`);
  await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();

  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const eventName = `Portal architecture workshop ${unique}`;
  const eventSlug = `portal-architecture-workshop-${unique}`;

  // Two controls legitimately read "Create event": the list toolbar's button
  // that opens the form, and the form's own submit. Each is addressed through
  // the surface that owns it rather than by adding `.first()`.
  const eventsToolbar = page.getByRole("toolbar", { name: "Group events controls" });
  await eventsToolbar.getByRole("button", { name: "Create event" }).click();
  const eventForm = page.getByRole("region", { name: "New group event" });
  await page.getByLabel("Event name").fill(eventName);
  await page.getByLabel("Slug").fill(eventSlug);
  await expect(page.getByLabel("Slug")).toHaveValue(eventSlug);
  await page.getByLabel("Start date").fill("2027-06-10T09:00");
  await page.getByLabel("End date").fill("2027-06-10T17:00");
  await page.getByLabel("Timezone").fill("Europe/Amsterdam");
  await page.getByLabel("Event profile").selectOption("workshop");
  await page.getByLabel("Peer invitation limit").fill("7");
  await page.getByLabel("Location").fill("Amsterdam and online");
  await page.getByLabel("Event resource URL").fill("https://example.test/portal-workshop");
  await page.getByRole("button", { name: "Add profile link" }).click();
  const eventCreated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/groups/${GROUP_ID}/events` &&
      response.request().method() === "POST",
  );
  await eventForm.getByRole("button", { name: "Create event", exact: true }).click();
  expect((await eventCreated).status()).toBe(201);

  const row = page.getByRole("row").filter({ hasText: eventName });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await openRow(row, `Open ${eventName}`);
  const detail = page.getByRole("region", { name: `${eventName} workspace` });
  await expect(detail.getByText("Amsterdam and online", { exact: true })).toBeVisible();
  await expect(detail.locator('a[href="https://example.test/portal-workshop"]')).toHaveAttribute(
    "href",
    "https://example.test/portal-workshop",
  );
  await expect(page.getByRole("link", { name: "Open registration" })).toHaveCount(0);

  await tab(detail, "Communications").click();
  const communications = detail.locator("details").filter({ has: page.getByText("Email campaigns", { exact: true }) });
  await communications.getByText("Email campaigns", { exact: true }).click();
  await communications.getByPlaceholder("Email subject").fill("Workshop planning update");
  await communications.getByPlaceholder("Write your message here, or load a template above.").fill("Hello members");
  const campaignPreview = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/email/campaigns/previews") &&
      response.request().method() === "POST",
  );
  await communications.getByRole("button", { name: "Preview Email" }).click();
  expect((await campaignPreview).status()).toBe(200);
  await expect(communications.getByText("Email Preview", { exact: true })).toBeVisible();
  await expect(communications.getByText("0 recipients", { exact: true })).toBeVisible();

  await tab(detail, "Settings").click();
  let registrationSetup = page.getByRole("region", { name: `Configure ${eventName} registration` });
  await registrationSetup.getByRole("button", { name: "Add attendee term" }).click();
  await registrationSetup.getByLabel("Key").fill("event-terms");
  await registrationSetup.getByLabel("Agreement text").fill("I agree to the workshop terms");
  const termsSaved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/terms") &&
      response.request().method() === "PUT",
  );
  await registrationSetup.getByRole("button", { name: "Save terms" }).click();
  expect((await termsSaved).status()).toBe(200);

  const policySection = registrationSetup.locator("details").filter({ hasText: "Policy and registration questions" });
  await policySection.getByLabel("Registration policy").selectOption("optional");
  const registrationSettingsSaved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/registration-settings") &&
      response.request().method() === "PUT",
  );
  await policySection.getByRole("button", { name: "Save registration settings" }).click();
  expect((await registrationSettingsSaved).status()).toBe(200);

  await policySection.getByRole("button", { name: "Create registration form" }).click();
  // Located by the region's accessible name rather than a framework class,
  // so the spec keeps working the next time this surface is restyled.
  const formEditor = policySection.getByRole("region", { name: "New registration form" });
  const formKey = `workshop-registration-${unique}`;
  await formEditor.getByLabel("Key", { exact: true }).fill(formKey);
  await expect(formEditor.getByLabel("Key", { exact: true })).toHaveValue(formKey);
  await formEditor.getByLabel("Title").fill("Workshop registration questions");
  await expect(formEditor.getByLabel("Key", { exact: true })).toHaveValue(formKey);
  await formEditor.getByPlaceholder("field_key").fill("participation_goal");
  await formEditor.getByPlaceholder("Field label").fill("What do you want to learn?");
  const formCreated = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/forms/event_registration") &&
      response.request().method() === "POST",
  );
  await formEditor.getByRole("button", { name: "Create form" }).click();
  expect((await formCreated).status()).toBe(201);
  // The picker is a combobox now: the attached form's title reads back from
  // the input's value rather than from a selected <option>'s text.
  await expect(policySection.getByLabel("Registration questions", { exact: true })).toHaveValue(
    "Workshop registration questions",
  );

  registrationSetup = page.getByRole("region", { name: `Configure ${eventName} registration` });
  await registrationSetup.getByText("Attendance days", { exact: true }).click();
  await registrationSetup.getByRole("button", { name: "Add day" }).click();
  await registrationSetup.getByLabel("Date").fill("2027-06-10");
  await registrationSetup.getByLabel("Starts at").fill("09:00");
  await registrationSetup.getByLabel("Ends at").fill("17:00");
  await registrationSetup.getByRole("button", { name: "Add attendance option" }).click();
  await registrationSetup.getByLabel("Value").fill("in_person");
  await registrationSetup.getByLabel("Label").last().fill("In person");
  await registrationSetup.getByLabel("Capacity").fill("40");
  const daysSaved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/days") &&
      response.request().method() === "PUT",
  );
  await registrationSetup.getByRole("button", { name: "Save days" }).click();
  expect((await daysSaved).status()).toBe(200);

  await page.getByRole("button", { name: "Edit event" }).click();
  const editor = page.getByRole("heading", { name: "Edit event" }).locator("..");
  await expect(editor.getByLabel("Peer invitation limit")).toHaveValue("7");
  await editor.getByLabel("Peer invitation limit").fill("9");
  await editor.getByLabel("Location").fill("Rotterdam and online");
  await editor.getByRole("button", { name: "Save event" }).click();
  await tab(detail, "Overview").click();
  await expect(detail.getByText("Rotterdam and online", { exact: true })).toBeVisible();

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
      registrationPolicy: "optional",
      inviteLimitAttendee: 9,
      location: "Rotterdam and online",
    }),
  );

  const configuration = await page.evaluate(
    async ({ groupId, eventId }) => {
      const [terms, days, registrationSettings] = await Promise.all([
        fetch(`/api/v1/groups/${groupId}/events/${eventId}/terms`, { credentials: "same-origin" }),
        fetch(`/api/v1/groups/${groupId}/events/${eventId}/days`, { credentials: "same-origin" }),
        fetch(`/api/v1/groups/${groupId}/events/${eventId}/registration-settings`, {
          credentials: "same-origin",
        }),
      ]);
      return {
        terms: { status: terms.status, body: await terms.json() },
        days: { status: days.status, body: await days.json() },
        registrationSettings: { status: registrationSettings.status, body: await registrationSettings.json() },
      };
    },
    { groupId: GROUP_ID, eventId: groupEventsListResponseSchema.parse(stored.body).events[0].id },
  );
  expect(configuration.terms.status, JSON.stringify(configuration.terms.body)).toBe(200);
  expect(groupEventTermsResponseSchema.parse(configuration.terms.body).terms.attendee).toEqual([
    expect.objectContaining({ term_key: "event-terms", display_text: "I agree to the workshop terms" }),
  ]);
  expect(configuration.days.status, JSON.stringify(configuration.days.body)).toBe(200);
  expect(groupEventDaysResponseSchema.parse(configuration.days.body).days).toEqual([
    expect.objectContaining({
      date: "2027-06-10",
      attendanceOptions: [{ value: "in_person", label: "In person", capacity: 40 }],
    }),
  ]);
  expect(configuration.registrationSettings.status, JSON.stringify(configuration.registrationSettings.body)).toBe(200);
  expect(groupEventRegistrationSettingsResponseSchema.parse(configuration.registrationSettings.body)).toMatchObject({
    registrationPolicy: "optional",
  });

  const publicShells = [
    ["register/", "data-event-registration"],
    ["register/confirm/", "data-event-registration-confirm"],
    ["register/manage/", "data-event-registration-manage"],
    ["propose/", "data-event-proposal"],
    ["propose/manage/", "data-event-proposal-manage"],
    ["propose/speaker/", "data-event-speaker-manage"],
    ["propose/presentation/", "data-event-speaker-presentation"],
    ["invite/decline/", "data-invite-decline"],
  ] as const;
  for (const [suffix, marker] of publicShells) {
    const response = await page.request.get(`/events/2027/${eventSlug}/${suffix}`);
    expect(response.status(), suffix).toBe(200);
    expect(response.headers()["cache-control"], suffix).toContain("no-store");
    expect(await response.text(), suffix).toContain(marker);
  }

  const unknownPage = await page.request.get(`/events/2027/${eventSlug}/unknown/`);
  expect(unknownPage.status()).toBe(404);

  await page.goto(`/events/2027/${eventSlug}/register/`);
  await expect(page.locator("[data-event-registration]")).toBeVisible();
  await expect(page.getByLabel("First name")).toBeVisible();
});
