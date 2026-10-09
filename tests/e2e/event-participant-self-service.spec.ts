import { expect, test } from "@playwright/test";
import {
  speakerProfileUpdateResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../../assets/shared/schemas/speaker-self-service";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../assets/shared/schemas/registration";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { signInToPortal } from "./helpers/portal-auth";
import { submitProposal, inviteCoSpeaker, PROPOSAL_EVENT_SLUG } from "./helpers/proposals";
import { registerInBrowser } from "./helpers/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test.use({ actionTimeout: 15_000 });

// Event-only identities deliberately have no staff or membership capacity.
test("attendee manages a registration and downloads a personal event calendar", async ({ page }, testInfo) => {
  const email = `portal-attendee-${Date.now()}@example.test`;
  const since = await capturedEmailCount();
  await registerInBrowser(page, email);
  const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible();
  await signInToPortal(page, email);
  await expect(page).toHaveURL(/#\/events$/);
  await page.goto("/portal/#/home");
  const personalCalendar = page.getByRole("link", {
    name: /Download your personal calendar for Post-Quantum Cryptography Conference/,
  });
  await expect(personalCalendar).toBeVisible();
  const calendarResponse = await page.request.get((await personalCalendar.getAttribute("href")) ?? "");
  expect(calendarResponse.status()).toBe(200);
  expect(await calendarResponse.text()).toContain("BEGIN:VCALENDAR");
  await page.goto("/portal/#/events");
  await page.getByRole("link", { name: "Open Post-Quantum Cryptography Conference", exact: true }).click();
  await page.getByRole("link", { name: "Manage registration", exact: true }).click();
  // The registration opens read-only: its details are facts, not fields.
  const registration = page.getByRole("region", { name: "Registration", exact: true });
  await expect(registration.getByText(email, { exact: true })).toBeVisible();
  await expect(registration.getByRole("textbox")).toHaveCount(0);
  await registration.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("US");
  await expect(registration.getByRole("button", { name: "Registration actions" })).toHaveCount(0);
  await page.getByLabel("Job title", { exact: true }).fill("Updated attendee");
  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith("/api/v1/registrations/") && response.request().method() === "PATCH",
    { timeout: 10_000 },
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  expect(registrationManageSchema.parse(saved.request().postDataJSON())).toMatchObject({
    action: "update",
    jobTitle: "Updated attendee",
  });
  registrationManageUpdateResponseSchema.parse(await saved.json());
  await expect(page.getByText("Registration updated.", { exact: true })).toBeVisible();
  await expect(registration.getByText("Updated attendee", { exact: true })).toBeVisible();
  await expect(registration.getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await expect(registration.getByText("Updated attendee", { exact: true })).toBeVisible();
  // Discarding an edit sends nothing and returns to the saved facts.
  await registration.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Job title", { exact: true })).toHaveValue("Updated attendee");
  await page.getByLabel("Job title", { exact: true }).fill("Discarded title");
  await registration.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(registration.getByText("Updated attendee", { exact: true })).toBeVisible();
  await expect(registration.getByText("Discarded title")).toHaveCount(0);
  // Cancelling is a whole-record command: the record menu, then the confirmation.
  await registration.getByRole("button", { name: "Registration actions" }).click();
  await page.getByRole("menuitem", { name: "Cancel my registration…" }).click();
  await acceptConfirmDialog(page, "Cancel registration");
  await expect(page.getByRole("button", { name: "Restore registration" })).toBeVisible();
  await page.getByRole("button", { name: "Restore registration" }).click();
  await expect(registration.getByRole("button", { name: "Registration actions" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(registration.getByText(email, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("registration-mobile.png"), fullPage: true });
});

test("proposer and invited speaker manage their own event records without emailed management tokens", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/portal/");
  const proposerEmail = `portal-proposer-${Date.now()}@example.test`;
  const speakerEmail = `portal-speaker-${Date.now()}@example.test`;
  const title = `Portal proposal ${Date.now()}`;
  const proposal = await submitProposal(page, {
    proposerEmail,
    firstName: "Portal",
    lastName: "Proposer",
    title,
    abstract:
      "A sufficiently detailed proposal describing how participants can manage their event records directly in the portal.",
  });
  expect(
    await inviteCoSpeaker(page, proposal.accessToken, {
      email: speakerEmail,
      firstName: "Portal",
      lastName: "Speaker",
    }),
  ).toBe(200);
  await signInToPortal(page, proposerEmail);
  await page.getByRole("link", { name: "Open Post-Quantum Cryptography Conference", exact: true }).click();
  await page.getByRole("link", { name: "View your proposals and speaker participation" }).click();
  await page.getByRole("link", { name: title, exact: true }).click();
  // The submission opens read-only; withdrawal lives in its menu, never beside saving.
  const submission = page.getByRole("region", { name: "Submission", exact: true });
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Withdraw proposal/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Submission actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Withdraw proposal…", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await submission.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title + " edited");
  await page.getByRole("button", { name: "Save proposal", exact: true }).click();
  await expect(page.getByText("Proposal updated.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("definition").filter({ hasText: title + " edited" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("proposal-desktop.png"), fullPage: true });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const speaker = await context.newPage();
  try {
    await signInToPortal(speaker, speakerEmail);
    await speaker.goto(`/portal/#/events/${PROPOSAL_EVENT_SLUG}/proposals/${proposal.proposalId}`);
    await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeVisible();
    for (const checkbox of await speaker.getByRole("checkbox").all()) await checkbox.check();
    await speaker.getByRole("button", { name: "Confirm participation", exact: true }).click();
    await expect(
      speaker.getByRole("alert").filter({ hasText: "Confirm your speaker identity before confirming participation." }),
    ).toBeVisible();
    const profilePath = `/api/v1/proposals/${proposal.proposalId}/participation/profile`;
    const before = speakerSelfServiceReadResponseSchema.parse(
      await (await speaker.request.get(`/api/v1/proposals/${proposal.proposalId}/participation`)).json(),
    );
    expect(before.speaker.status).toBe("invited");
    expect(before.profile.actingIdentitySelection).toBe("unrecorded");
    await speaker
      .getByRole("radio", { name: "No — I am not employed by and do not own an organization", exact: true })
      .check();
    const attestation = speaker.getByRole("checkbox", {
      name: "I am not employed by, do not own, and am not authorized to represent an organization.",
      exact: true,
    });
    await expect(attestation).not.toBeChecked();
    await attestation.click();
    await expect(speaker.getByText("Individual participation", { exact: true })).toBeVisible();
    await expect(attestation).toHaveCount(0);
    await expect(speaker.getByLabel("Organization", { exact: true })).toHaveCount(0);
    await expect(speaker.getByLabel("Job title", { exact: true })).toHaveCount(0);
    const selectionResponse = speaker.waitForResponse(
      (response) => new URL(response.url()).pathname === profilePath && response.request().method() === "PATCH",
    );
    await speaker.getByRole("button", { name: "Save speaker profile", exact: true }).click();
    const selectedResponse = await selectionResponse;
    expect(selectedResponse.status()).toBe(200);
    const selectedBody = speakerSelfProfilePatchSchema.parse(selectedResponse.request().postDataJSON());
    expect(selectedBody.actingIdentityId).toBeNull();
    expect(selectedBody.unaffiliatedAttestation).toBe(true);
    const selected = speakerProfileUpdateResponseSchema.parse(await selectedResponse.json());
    expect(selected.profile.actingIdentitySelection).toBe("individual");
    expect(selected.profile.actingIdentitySelectedAt).not.toBeNull();
    await expect(speaker.getByText("Speaker profile saved.", { exact: true })).toBeVisible();
    await speaker.getByRole("button", { name: "Confirm participation", exact: true }).click();
    await expect(speaker.getByText("Participation confirmed.", { exact: true })).toBeVisible();
    await expect(speaker.getByRole("button", { name: "Save proposal", exact: true })).toHaveCount(0);
    // The saved profile reads back as text until the reader chooses to edit it.
    const bio = speaker.getByRole("textbox", { name: "Biography", exact: true });
    await expect(bio).toHaveCount(0);
    await expect(speaker.getByRole("button", { name: "Save speaker profile", exact: true })).toHaveCount(0);
    await speaker
      .getByRole("region", { name: "Speaker profile", exact: true })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await bio.fill("Guest speaker biography saved through authenticated self-service.");
    await speaker.getByRole("button", { name: "Save speaker profile", exact: true }).click();
    await expect(speaker.getByText("Speaker profile saved.", { exact: true })).toBeVisible();
    await expect(bio).toHaveCount(0);
    await speaker.reload();
    await expect(
      speaker
        .getByRole("definition")
        .filter({ hasText: "Guest speaker biography saved through authenticated self-service." }),
    ).toBeVisible();
    const restored = speakerSelfServiceReadResponseSchema.parse(
      await (await speaker.request.get(`/api/v1/proposals/${proposal.proposalId}/participation`)).json(),
    );
    expect(restored.speaker.status).toBe("confirmed");
    expect(restored.profile.actingIdentitySelectedAt).toBe(selected.profile.actingIdentitySelectedAt);
    expect(restored.profile.organizationName).toBeNull();
    expect(restored.profile.jobTitle).toBeNull();
  } finally {
    await context.close();
  }
});
