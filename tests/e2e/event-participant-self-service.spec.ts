import sharp from "sharp";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { expect, test } from "@playwright/test";
import {
  speakerProfileUpdateResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../../assets/shared/schemas/speaker-self-service";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../assets/shared/schemas/registration";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { signInToPortal } from "./helpers/portal-auth";
import { submitProposal, inviteCoSpeaker, PROPOSAL_EVENT_SLUG } from "./helpers/proposals";
import { registerInBrowser } from "./helpers/registration";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";

import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identityCreateSchema, identityMutationResponseSchema } from "../../assets/shared/schemas/identity";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { myActiveIdentitySwitchSchema } from "../../assets/shared/schemas/me";
import { myProfileUpdateSchema } from "../../assets/shared/schemas/me";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createRegistrationEvent } from "./helpers/participation-state-fixture";
import { capturedEmailCount, waitForCapturedEmail, extractEmailUrl } from "./helpers/sendgrid";

test.use({ actionTimeout: 15_000 });

test("a signed-in user registers from event home without another email challenge", async ({ page }, info) => {
  const email = e2eAdminEmail("portal-agenda-preview");
  await signInAsE2eStaff(page, email);
  const profile = await page.request.patch("/api/v1/users/current", {
    data: myProfileUpdateSchema.parse({ firstName: "Ada", lastName: "Example" }),
  });
  expect(profile.status(), await profile.text()).toBe(200);
  const currentSession = userAuthSessionResponseSchema.parse(
    await (await page.request.get("/api/v1/auth/session")).json(),
  );
  const representations = [];
  for (const name of ["Northstar Trust Association", "Harbor Security Labs"]) {
    const createdOrganization = await page.request.post("/api/v1/organizations", {
      data: organizationCreateSchema.parse({
        name,
        membershipCategory: "F",
        memberSince: "2026-01-01",
      }),
    });
    expect(createdOrganization.status(), await createdOrganization.text()).toBe(201);
    const organization = organizationCreateResponseSchema.parse(await createdOrganization.json()).organization;
    const createdIdentity = await page.request.post(`/api/v1/organizations/${organization.id}/identities`, {
      data: identityCreateSchema.parse({
        userReference: "existing_user",
        userId: currentSession.identity.id,
        jobTitle: "Conference representative",
        activation: { mode: "immediate", reason: "Synthetic registration identity-selection regression fixture" },
      }),
    });
    expect(createdIdentity.status(), await createdIdentity.text()).toBe(201);
    representations.push({
      name: organization.name,
      id: identityMutationResponseSchema.parse(await createdIdentity.json()).identityId,
    });
  }
  const selected = await page.request.put("/api/v1/users/current/identities/active", {
    data: myActiveIdentitySwitchSchema.parse({ identityId: representations[0].id }),
  });
  expect(selected.status(), await selected.text()).toBe(200);
  const dayDate = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const event = await createRegistrationEvent(page, "quick-registration", {
    date: dayDate,
    startTime: "09:00",
    endTime: "17:00",
  });
  await page.goto(`/portal/#/events/${event.slug}`);
  await expect(page.getByRole("button", { name: "Register", exact: true })).toBeVisible();
  await expect(page.getByText("Nothing on your agenda yet", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "My agenda", exact: true })).toHaveCount(0);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`unregistered-event-home-${device}.png`) });
  }
  const challenged: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(?:proof|auth\/request)(?:\/|$)/.test(new URL(request.url()).pathname))
      challenged.push(request.url());
  });
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Register for this event", exact: true });
  await expect(dialog.getByText(email, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await page.goForward();
  await expect(dialog.getByText(email, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Work email", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Representation", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.locator('[data-step="1"]')).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-representation-${device}.png`) });
  }
  await dialog.getByRole("button", { name: "Change representation", exact: true }).click();
  const representationChooser = page.getByRole("dialog", { name: "Change representation", exact: true });
  await representationChooser.getByRole("combobox", { name: "Representation", exact: true }).click();
  const currentOption = page.getByRole("option").filter({ hasText: representations[0].name });
  const otherOption = page.getByRole("option").filter({ hasText: representations[1].name });
  await expect(currentOption).toBeVisible();
  await expect(currentOption).toHaveAttribute("aria-selected", "true");
  await expect(otherOption).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-identity-choices-${device}.png`) });
  }
  await otherOption.click();
  await expect(representationChooser.getByRole("combobox", { name: "Representation", exact: true })).toBeVisible();
  await representationChooser.getByRole("button", { name: "Add identity", exact: true }).click();
  const addIdentity = page.getByRole("dialog", { name: "Add identity", exact: true });
  await expect(addIdentity.getByRole("textbox", { name: /^Representation email/ })).toBeVisible();
  await expect(addIdentity.getByRole("combobox")).toHaveCount(0);
  await page.goBack();
  await expect(addIdentity).not.toBeVisible();
  await expect(representationChooser).toBeVisible();
  await page.goForward();
  await expect(addIdentity).toBeVisible();
  await addIdentity.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(addIdentity).not.toBeVisible();
  await expect(representationChooser.getByRole("combobox", { name: "Representation", exact: true })).toBeVisible();

  await representationChooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(representationChooser).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Register", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(dialog.getByText(email, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog.locator('[data-step="1"]')).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("quick-registration-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: info.outputPath("quick-registration-phone.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.locator(`label[for="dayAttendance-${dayDate}-in_person"]`).click();
  await expect(dialog.getByRole("radio", { name: "In person", exact: true })).toBeChecked();
  await page.goBack();
  await expect(dialog.getByText("Representation", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(dialog.getByRole("radio", { name: "In person", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Register", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "I agree to the privacy policy", exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(dialog.getByText("Too small:", { exact: false })).toHaveCount(0);
  await expect(dialog.locator('[data-step="4"]')).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-consent-error-${device}.png`) });
  }
  await page.goBack();
  await expect(dialog.getByText("No additional questions.", { exact: true })).toBeVisible();
  await page.goForward();
  await dialog.getByRole("checkbox", { name: "I agree to the privacy policy", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "I agree to the code of conduct", exact: true }).check();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${event.slug}/registrations` &&
      response.request().method() === "POST",
  );
  const beforeConfirmationEmail = await capturedEmailCount();
  await dialog.getByRole("button", { name: "Register", exact: true }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  const result = registrationSubmissionResponseSchema.parse(await response.json());
  const body = registrationCreateSchema.parse(response.request().postDataJSON());
  expect(body.identityId).toBe(representations[0].id);
  expect(body.email).toBe(email);
  expect(body.emailProof).toBeUndefined();
  expect(body.dayAttendance).toEqual([{ dayDate, attendanceType: "in_person" }]);
  expect(result.status).toBe("registered");
  await expect(page).toHaveURL(new RegExp(`#/events/${event.slug}/ticket$`));
  await expect(dialog).not.toBeVisible();
  expect(challenged).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No ticket yet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Registration details", exact: true })).toBeVisible();
  const socialBadge = page.locator("[data-og-badge-img]");
  await expect(socialBadge).toHaveAttribute("src", /layout=promotion-scene-v7/);
  await expect
    .poll(() => socialBadge.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  await expect(page.getByRole("link", { name: "Download badge", exact: true })).toBeVisible();
  const squareDownload = page.getByRole("link", { name: "Download square badge", exact: true });
  await expect(squareDownload).toBeVisible();
  const squareImage = await page.request.get((await squareDownload.getAttribute("href"))!);
  expect(squareImage.status()).toBe(200);
  const squareBytes = await squareImage.body();
  const squareMetadata = await sharp(squareBytes).metadata();
  expect({ width: squareMetadata.width, height: squareMetadata.height }).toEqual({ width: 1080, height: 1080 });
  await info.attach("square-social-badge", { body: squareBytes, contentType: squareImage.headers()["content-type"]! });
  const confirmation = await waitForCapturedEmail(email, "confirmed", { since: beforeConfirmationEmail });
  const attachments = confirmation.payload.attachments as Array<{ type: string; content: string }>;
  const attachment = attachments.find((item) => item.type.startsWith("image/"));
  expect(attachment).toBeDefined();
  const renderedBadge = await page.request.get((await socialBadge.getAttribute("src"))!);
  expect(renderedBadge.status()).toBe(200);
  expect(Buffer.from(attachment!.content, "base64")).toEqual(await renderedBadge.body());
  await info.attach("emailed-social-badge", {
    body: Buffer.from(attachment!.content, "base64"),
    contentType: attachment!.type,
  });
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await socialBadge.scrollIntoViewIfNeeded();
    const ratio = await socialBadge.evaluate((image: HTMLImageElement) => ({
      displayed: image.clientWidth / image.clientHeight,
      source: image.naturalWidth / image.naturalHeight,
    }));
    expect(ratio.displayed).toBeCloseTo(ratio.source, 1);
    await page.screenshot({ path: info.outputPath(`registration-social-badge-${device}.png`) });
  }
  await page.getByRole("link", { name: "Registration details", exact: true }).click();
  await page.getByRole("button", { name: "Change representation", exact: true }).click();
  const changeIdentity = page.getByRole("dialog", { name: "Change representation", exact: true });
  await changeIdentity.getByRole("combobox", { name: "Representation", exact: true }).click();
  await page.getByRole("option").filter({ hasText: representations[1].name }).click();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`portal-update-identity-${device}.png`) });
  }
  await changeIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Add identity", exact: true })
      .getByRole("textbox", { name: /^Representation email/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Add identity", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await changeIdentity.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(changeIdentity).not.toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: representations[1].name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("definition").filter({ hasText: representations[1].name })).toBeVisible();
  await page.getByRole("button", { name: "Change representation", exact: true }).click();
  await changeIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
  const addRepresentation = page.getByRole("dialog", { name: "Add identity", exact: true });
  await addRepresentation.getByRole("textbox", { name: /^Representation email/ }).fill("ada@lighthouse-work.test");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`representation-email-${device}.png`) });
  }
  const inboxStart = await capturedEmailCount();
  await addRepresentation.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(addRepresentation.getByRole("button", { name: "Check verification", exact: true })).toBeVisible();
  await expect(addRepresentation.getByRole("combobox")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("representation-verification-phone.png") });
  const verificationEmail = await waitForCapturedEmail("ada@lighthouse-work.test", "Verify", { since: inboxStart });
  const verification = await page.context().newPage();
  await verification.goto(extractEmailUrl(verificationEmail, "/portal/"));
  await verification.getByRole("button", { name: "Verify this address", exact: true }).click();
  await expect(verification.getByText("ada@lighthouse-work.test is verified", { exact: true })).toBeVisible();
  await verification.close();
  await addRepresentation.getByRole("button", { name: "Check verification", exact: true }).click();
  await addRepresentation.getByRole("textbox", { name: /^Organization name/ }).fill("Lighthouse Research");
  await addRepresentation.getByRole("textbox", { name: /^Job title/ }).fill("Security engineer");
  await expect(addRepresentation.getByRole("combobox")).toHaveCount(0);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`representation-verified-details-${device}.png`) });
  }
  await addRepresentation.getByRole("button", { name: "Add representation", exact: true }).click();
  await expect(addRepresentation).not.toBeVisible();
  await expect(changeIdentity.getByRole("combobox", { name: "Representation", exact: true })).toContainText(
    "Lighthouse Research",
  );
  await changeIdentity.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(changeIdentity).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("definition").filter({ hasText: "Lighthouse Research" })).toBeVisible();
});

// Event-only identities deliberately have no staff or membership capacity.
test("attendee manages a registration and downloads a personal event calendar", async ({ page }, testInfo) => {
  // A personal address takes part as an individual: confirming it names no organization.
  const email = `portal-attendee-${crypto.randomUUID()}@gmail.com`;
  // Verified first, so the registration is final when submitted.
  await registerInBrowser(page, email, undefined, undefined, { individual: true });
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
  await page
    .getByRole("heading", { name: "Post-Quantum Cryptography Conference", exact: true })
    .getByRole("link", { name: "Post-Quantum Cryptography Conference", exact: true })
    .click();
  await page.getByRole("link", { name: "Manage registration", exact: true }).click();
  // The registration opens read-only: its details are facts, not fields (the invitation link is a read-only copy field).
  const registration = page.getByRole("region", { name: "Registration", exact: true });
  await expect(registration.getByText(email, { exact: true })).toBeVisible();
  await expect(registration.locator("input:not([readonly]):not([type=hidden]), textarea, select")).toHaveCount(0);
  await registration.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("US");
  await expect(registration.getByRole("button", { name: "Registration actions" })).toHaveCount(0);
  await page.getByLabel("Last name", { exact: true }).fill("Updated-Attendee");
  await page.goBack();
  await expect(registration.getByRole("button", { name: "Edit details", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Updated-Attendee");
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
    lastName: "Updated-Attendee",
  });
  registrationManageUpdateResponseSchema.parse(await saved.json());
  await expect(page.getByText("Registration updated.", { exact: true })).toBeVisible();
  await expect(registration.getByText(/Updated-Attendee/)).toBeVisible();
  await expect(registration.locator("input:not([readonly]):not([type=hidden]), textarea, select")).toHaveCount(0);
  await page.reload();
  await expect(registration.getByText(/Updated-Attendee/)).toBeVisible();
  // Discarding an edit sends nothing and returns to the saved facts.
  await registration.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByLabel("Last name", { exact: true })).toHaveValue("Updated-Attendee");
  await page.getByLabel("Last name", { exact: true }).fill("Discarded-Name");
  await registration.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(registration.getByText(/Updated-Attendee/)).toBeVisible();
  await expect(registration.getByText(/Discarded-Name/)).toHaveCount(0);
  // Cancelling sits apart at the end of the record, behind the confirmation.
  await registration.getByRole("button", { name: "Cancel my registration…", exact: true }).click();
  await acceptConfirmDialog(page, "Cancel registration");
  await expect(page.getByRole("button", { name: "Restore registration" })).toBeVisible();
  await page.getByRole("button", { name: "Restore registration" }).click();
  await expect(registration.getByRole("button", { name: "Edit details", exact: true })).toBeEnabled();
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
      role: "speaker",
    }),
  ).toBe(200);
  await signInToPortal(page, proposerEmail);
  await page
    .getByRole("heading", { name: "Post-Quantum Cryptography Conference", exact: true })
    .getByRole("link", { name: "Post-Quantum Cryptography Conference", exact: true })
    .click();
  await page.getByRole("link", { name: "View proposals", exact: true }).click();
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
    const individual = speaker.getByRole("button", { name: EMAIL_FIRST_COPY.speaker.individualSwitch, exact: true });
    // Choosing resolves the signed-in speaker's representation at once, so the question closes on click.
    await individual.click();
    await expect(speaker.getByText("Individual participation", { exact: true })).toBeVisible();
    await expect(individual).toHaveCount(0);
    await completeIndependentCapacityDisclosure(speaker);
    await expect(speaker.getByLabel("Organization", { exact: true })).toHaveCount(0);
    await expect(speaker.getByLabel("Job title", { exact: true })).toHaveCount(0);
    const selectionResponse = speaker.waitForResponse(
      (response) => new URL(response.url()).pathname === profilePath && response.request().method() === "PATCH",
    );
    await speaker.getByRole("button", { name: "Save speaker identity", exact: true }).click();
    const selectedResponse = await selectionResponse;
    expect(selectedResponse.status()).toBe(200);
    const selectedBody = speakerSelfProfilePatchSchema.parse(selectedResponse.request().postDataJSON());
    expect(selectedBody.actingIdentityId).toBeNull();
    expect(selectedBody.unaffiliatedAttestation).toBe(true);
    const selected = speakerProfileUpdateResponseSchema.parse(await selectedResponse.json());
    expect(selected.profile.actingIdentitySelection).toBe("individual");
    expect(selected.profile.actingIdentitySelectedAt).not.toBeNull();
    await expect(speaker.getByText("Speaker identity saved.", { exact: true })).toBeVisible();
    await speaker.getByRole("button", { name: "Confirm participation", exact: true }).click();
    await expect(speaker.getByText("Participation confirmed.", { exact: true })).toBeVisible();
    await expect(speaker.getByRole("button", { name: "Save proposal", exact: true })).toHaveCount(0);
    // The saved profile reads back as text until the reader chooses to edit it.
    const bio = speaker.getByRole("textbox", { name: "Your speaker bio", exact: true });
    await expect(bio).toHaveCount(0);
    await expect(speaker.getByRole("button", { name: "Save speaker identity", exact: true })).toHaveCount(0);
    await speaker
      .getByRole("region", { name: "Speaker profile", exact: true })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await bio.fill("Guest speaker biography saved through authenticated self-service.");
    await speaker.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(speaker.getByText("Profile updated.", { exact: true })).toBeVisible();
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
