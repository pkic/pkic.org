/**
 * @covers event.3.1
 */
import { expect, test } from "@playwright/test";
import {
  groupEventDetailResponseSchema,
  groupEventDaysResponseSchema,
  groupEventRegistrationSettingsResponseSchema,
  groupEventTermsResponseSchema,
  groupEventsListResponseSchema,
} from "../../assets/shared/schemas/group-events";
import { eventInvitePreviewResponseSchema } from "../../assets/shared/schemas/event-invite-bulk";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openRow } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";
import { publishE2eSite } from "./helpers/site-publication";
import { expectStyledEmailPreview, useEmailPreviewLogoFixture } from "./helpers/email-preview";
import { tab } from "./helpers/tabs";

test.use({ timezoneId: "Europe/Amsterdam" });

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

test("a portal manager creates and edits a group-owned standalone event", async ({ page }) => {
  await useEmailPreviewLogoFixture(page);
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  await page.goto(`/portal/#/groups/${GROUP_ID}/events`);
  await expect(page.getByRole("heading", { name: "Post-Quantum Cryptography Working Group" })).toBeVisible();

  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const eventName = `Portal architecture workshop ${unique}`;
  const eventSlug = `portal-architecture-workshop-${unique}`;

  /*
   * Two controls legitimately read "Create event": the list toolbar's button
   * that opens the page, and the page's own submit. Each is addressed through
   * the surface that owns it rather than by adding `.first()`.
   */
  const eventsToolbar = page.getByRole("toolbar", { name: "Group events controls" });
  await eventsToolbar.getByRole("button", { name: "Create event" }).click();
  // Creating is a page of its own: the list it adds to is not underneath it.
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/events/new$`));
  const eventForm = page.getByRole("region", { name: "New group event" });
  await expect(eventsToolbar).toHaveCount(0);
  await page.getByLabel("Event name").fill(eventName);
  await page.getByLabel("Slug").fill(eventSlug);
  await expect(page.getByLabel("Slug")).toHaveValue(eventSlug);
  await page.getByLabel("Start date").fill("2027-06-10T09:00");
  await page.getByLabel("End date").fill("2027-06-10T17:00");
  await page.getByLabel("Timezone").fill("Europe/Amsterdam");
  await page.getByLabel("Event profile").selectOption("workshop");
  await page.getByLabel("Visibility", { exact: true }).selectOption("public");
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
  const createdEvent = await eventCreated;
  expect(createdEvent.status()).toBe(201);
  const { event } = groupEventDetailResponseSchema.parse(await createdEvent.json());
  // And it returns to the list it added to.
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/events$`));

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

  await page.screenshot({ path: test.info().outputPath("event-attached-surface.png"), fullPage: true });

  await tab(detail, "Communications").click();
  await expect(detail.getByLabel("Audience", { exact: true })).toHaveCount(0);
  await detail.getByRole("link", { name: "New message" }).click();
  await expect(page).toHaveURL(/\/communications\/new$/);
  const communications = detail.getByRole("region", { name: "New event message" });
  const audience = communications.getByLabel("Audience", { exact: true });
  await audience.selectOption("attendee_invitations");
  await expect(communications.getByLabel("Invitation status")).toBeVisible();
  await expect(communications.getByText("Template helpers", { exact: true })).toHaveCount(0);
  const subject = communications.getByPlaceholder("Email subject");
  await communications.getByRole("button", { name: "Insert subject variable" }).click();
  await page.getByRole("menuitem", { name: "eventName", exact: true }).click();
  await expect(subject).toHaveValue("{{eventName}}");
  await communications.getByRole("button", { name: "Markdown source", exact: true }).click();
  await communications.getByRole("button", { name: "Insert variables and conditions" }).click();
  await page.getByRole("menuitem", { name: "registrationUrl", exact: true }).click();
  await expect(communications.getByRole("textbox", { name: "Message Markdown source" })).toHaveValue(
    "{{registrationUrl}}",
  );
  await communications.getByRole("button", { name: "Visual editor", exact: true }).click();
  const wideViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await communications.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await communications.screenshot({ path: test.info().outputPath("message-composer-mobile.png") });
  await page.setViewportSize(wideViewport);
  await communications.screenshot({ path: test.info().outputPath("message-composer-desktop.png") });
  await audience.selectOption("attendees");
  await communications.getByPlaceholder("Email subject").fill("Workshop planning update");
  await communications.getByRole("textbox", { name: "Message", exact: true }).fill("Hello members");
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
  // Give the campaign a purpose-created recipient so it renders the email layout.
  const invitePath = `/api/v1/groups/${GROUP_ID}/events/${event.id}/invites/attendees`;
  const invites = [{ email: `campaign-preview-${unique}@example.test`, firstName: "Alex", lastName: "Example" }];
  const invitationPreviewResponse = await page.request.post(`${invitePath}/preview`, { data: { invites } });
  expect(invitationPreviewResponse.status()).toBe(200);
  const invitationPreview = eventInvitePreviewResponseSchema.parse(await invitationPreviewResponse.json());
  const invitationCreated = await page.request.post(`${invitePath}/bulk`, {
    data: { invites, previewToken: invitationPreview.previewToken, inviteDigest: invitationPreview.inviteDigest },
  });
  expect(invitationCreated.status()).toBe(200);
  await audience.selectOption("attendee_invitations");
  await communications.getByRole("button", { name: "Preview Email" }).click();
  await expect(communications.getByText("1 recipients", { exact: true })).toBeVisible();
  const preview = communications.getByTitle("Rendered campaign email preview", { exact: true });
  await expectStyledEmailPreview(preview);
  await tab(communications, "Text").click();
  await expect(preview).toHaveCount(0);
  await tab(communications, "HTML").click();
  await expectStyledEmailPreview(preview);
  await preview.scrollIntoViewIfNeeded();
  await communications.screenshot({ path: test.info().outputPath("campaign-email-preview.png") });

  await tab(detail, "Settings").click();
  let registrationSetup = page.getByRole("region", { name: `Configure ${eventName} registration` });
  await expect(registrationSetup.getByLabel("Agreement text")).toHaveCount(0);
  await registrationSetup.getByRole("button", { name: "Event terms actions" }).click();
  await page.getByRole("menuitem", { name: "Edit terms", exact: true }).click();
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

  const policySection = registrationSetup.getByRole("region", { name: "Registration policy and questions" });
  await policySection.getByRole("button", { name: "Registration policy actions" }).click();
  await page.getByRole("menuitem", { name: "Edit settings", exact: true }).click();
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
  await formEditor.getByLabel("Form title", { exact: true }).fill("Workshop registration draft");
  await formEditor.getByRole("button", { name: "Change", exact: true }).click();
  await formEditor.getByLabel("Form key", { exact: true }).fill(formKey);
  // A key the author set themselves is theirs: retitling above it must not
  // rewrite it, which is the one thing the derivation must never do.
  await formEditor.getByLabel("Form title", { exact: true }).fill("Workshop registration questions");
  await expect(formEditor.getByLabel("Form key", { exact: true })).toHaveValue(formKey);
  await formEditor.getByLabel("Question", { exact: true }).fill("What do you want to learn?");
  await formEditor.getByRole("button", { name: /Key and reporting/ }).click();
  await formEditor.getByLabel("Field key", { exact: true }).fill("participation_goal");
  const formCreated = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/`) &&
      response.url().endsWith("/forms/event_registration") &&
      response.request().method() === "POST",
  );
  await formEditor.getByRole("button", { name: "Create form" }).click();
  expect((await formCreated).status()).toBe(201);
  await expect(policySection.getByText("Workshop registration questions", { exact: true })).toBeVisible();
  await expect(policySection.getByLabel("Registration questions", { exact: true })).toHaveCount(0);
  await policySection.getByRole("button", { name: "Registration questions actions" }).click();
  await page.getByRole("menuitem", { name: "Change attached form" }).click();
  await expect(policySection.getByLabel("Registration questions", { exact: true })).toHaveValue(
    "Workshop registration questions",
  );
  await policySection.getByRole("button", { name: "Cancel form selection" }).click();

  const submissionWindow = policySection.getByRole("region", { name: "Submission window", exact: true });
  await expect(submissionWindow).toContainText("No opening restriction");
  await expect(submissionWindow.locator("input")).toHaveCount(0);
  async function editWindow() {
    await submissionWindow.getByRole("button", { name: "Submission window actions" }).click();
    await page.getByRole("menuitem", { name: "Edit settings" }).click();
  }
  await editWindow();
  // Amsterdam's spring-forward gap must produce a field error, not silently move the opening time.
  await submissionWindow.getByLabel("Opens", { exact: true }).fill("2027-03-28T02:30");
  await submissionWindow.getByRole("button", { name: "Save submission window" }).click();
  await expect(submissionWindow.getByLabel("Opens", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await submissionWindow.getByLabel("Opens", { exact: true }).fill("2027-06-10T09:00");
  await submissionWindow.getByLabel("Closes", { exact: true }).fill("2027-06-10T08:00");
  await submissionWindow.getByRole("button", { name: "Save submission window" }).click();
  await expect(submissionWindow.getByLabel("Closes", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await submissionWindow.getByLabel("Closes", { exact: true }).fill("2027-06-10T17:00");
  const windowSaved = page.waitForResponse(
    (response) => response.url().endsWith("/forms/event_registration") && response.request().method() === "PATCH",
  );
  await submissionWindow.getByRole("button", { name: "Save submission window" }).click();
  const savedWindow = await windowSaved;
  expect(savedWindow.status()).toBe(200);
  expect(savedWindow.request().postDataJSON()).toMatchObject({
    opensAt: "2027-06-10T07:00:00.000Z",
    closesAt: "2027-06-10T15:00:00.000Z",
  });
  await expect(submissionWindow.locator("input")).toHaveCount(0);
  await page.reload();
  await expect(submissionWindow).toBeVisible();
  await editWindow();
  await expect(submissionWindow.getByLabel("Opens", { exact: true })).toHaveValue("2027-06-10T09:00");
  await expect(submissionWindow.getByLabel("Closes", { exact: true })).toHaveValue("2027-06-10T17:00");
  await submissionWindow.getByLabel("Opens", { exact: true }).fill("");
  await submissionWindow.getByRole("button", { name: "Cancel", exact: true }).click();
  await editWindow();
  await expect(submissionWindow.getByLabel("Opens", { exact: true })).toHaveValue("2027-06-10T09:00");
  await submissionWindow.getByRole("button", { name: "Cancel", exact: true }).click();

  registrationSetup = page.getByRole("region", { name: `Configure ${eventName} registration` });
  // Every setting is a panel open on arrival; nothing has to be unfolded.
  await registrationSetup.getByRole("button", { name: "Attendance days actions" }).click();
  await page.getByRole("menuitem", { name: "Edit attendance days", exact: true }).click();
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

  // The event's facts are edited where they are read: Edit is the details
  // panel's own command, and the panel becomes the form.
  await page.getByRole("button", { name: "Event actions" }).click();
  await page.getByRole("menuitem", { name: "Edit event", exact: true }).click();
  const editor = page.getByRole("region", { name: "Edit event" });
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
  await publishE2eSite(page, `/events/2027/${eventSlug}/register/`);
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
