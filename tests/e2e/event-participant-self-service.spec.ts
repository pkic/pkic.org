import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrenceCreateSchema,
} from "../../assets/shared/schemas/event-agenda";
import { readFile } from "node:fs/promises";
import { PERSONAL_PROMOTION_RENDERER } from "../../assets/shared/personal-promotion-image";
import sharp from "sharp";
import { userCreateSchema } from "../../assets/shared/schemas/user-create";
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

test("a signed-in user registers from event home without another email challenge", async ({ page, browser }, info) => {
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
  const fixtureSuffix = crypto.randomUUID().slice(0, 8);
  for (const name of [`Northstar Trust Association ${fixtureSuffix}`, `Harbor Security Labs ${fixtureSuffix}`]) {
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
  const event = await createRegistrationEvent(
    page,
    "quick-registration",
    [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
      date: new Date(Date.parse(dayDate) + offset * 86_400_000).toISOString().slice(0, 10),
      startTime: "09:00",
      endTime: "17:00",
      attendanceOptions: [
        { value: "in_person", label: "In person" },
        { value: "virtual", label: "Virtual" },
        { value: "on_demand", label: "On demand" },
        {
          value: "lounge",
          label: "Livestream Lounge",
          icon: "video_people" as const,
          description: "Watch together at a partner venue",
        },
      ],
    })),
  );
  await page.goto(`/portal/#/events/${event.slug}`);
  await expect(page.getByRole("link", { name: "Register", exact: true })).toBeVisible();
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
  await page.getByRole("link", { name: "Register", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/events/${event.slug}/register/$`));
  await expect(page.getByRole("heading", { name: "Register for this event", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Event registration", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Register for this event", exact: true })).toHaveCount(0);
  const registrationPage = page.locator("[data-registration-flow='create']");
  await expect(registrationPage.getByText(email, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(registrationPage).not.toBeVisible();
  await page.goForward();
  await expect(registrationPage.getByText(email, { exact: true })).toBeVisible();
  await expect(registrationPage.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(registrationPage.getByText("Representation", { exact: true })).toBeVisible();
  await expect(registrationPage.getByRole("combobox")).toHaveCount(0);
  await expect(registrationPage.locator('[data-step="1"]')).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-representation-${device}.png`) });
  }
  await registrationPage.getByRole("button", { name: "Change representation", exact: true }).click();
  const representationChooser = page.getByRole("dialog", { name: "Change representation", exact: true });
  await representationChooser.getByRole("button", { name: "Edit representation", exact: true }).click();
  const profileEditor = page.getByRole("dialog", { name: "Edit representation", exact: true });
  await profileEditor.getByRole("textbox", { name: "Job title for this organization" }).fill("Conference coordinator");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`edit-representation-${device}.png`) });
  }
  await profileEditor.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(profileEditor).not.toBeVisible();
  await expect(representationChooser.getByRole("combobox", { name: "Representation", exact: true })).toContainText(
    "Conference coordinator",
  );
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
  await expect(addIdentity.getByRole("textbox", { name: EMAIL_FIRST_COPY.representation.work.label })).toBeVisible();
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
  await expect(registrationPage).toBeVisible();
  await registrationPage.getByRole("button", { name: "Change representation", exact: true }).click();
  await representationChooser.getByRole("combobox", { name: "Representation", exact: true }).click();
  await page
    .getByRole("option")
    .filter({ hasText: /^Personal(?: ·|$)/ })
    .first()
    .click();
  await representationChooser.getByRole("button", { name: "Use representation", exact: true }).click();
  const personalWarning = registrationPage.getByRole("img", { name: /Please use your work address/ });
  await expect(personalWarning).toBeVisible();
  await expect(personalWarning).toHaveAttribute("title", /personal email address.*handled last/);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`personal-representation-warning-${device}.png`) });
  }
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/events/${event.slug}/register/$`));
  await expect(registrationPage.getByText(email, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(registrationPage.locator('[data-step="1"]')).toHaveCSS("opacity", "1");
  expect((await registrationPage.boundingBox())!.width).toBeGreaterThan(800);
  await page.screenshot({ path: info.outputPath("quick-registration-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: info.outputPath("quick-registration-phone.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await registrationPage.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(registrationPage.locator('[data-step="2"]')).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-attendance-${device}.png`) });
  }
  const matrix = registrationPage.getByRole("table", { name: "Attendance by day" });
  await registrationPage.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    registrationPage.getByRole("group", { name: "Attendance choices", exact: true }),
  ).toHaveAccessibleDescription("Choose how you'll attend the event.");
  await expect(registrationPage.getByRole("group", { name: "Attendance choices", exact: true })).toBeFocused();
  await matrix.getByRole("radio", { name: "In person — Workshop day 1", exact: true }).check();
  await registrationPage.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(registrationPage.locator('[data-step="2"]')).toBeVisible();
  await expect(
    registrationPage.getByRole("group", { name: "Attendance choices", exact: true }),
  ).toHaveAccessibleDescription(/Workshop day 2.*Not attending/);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await registrationPage.getByRole("group", { name: "Attendance choices", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`attendance-unanswered-day-${device}.png`) });
  }
  await matrix.getByRole("button", { name: "Choose Virtual for every available day", exact: true }).click();
  for (const radio of await matrix.getByRole("radio", { name: /^Virtual — / }).all()) await expect(radio).toBeChecked();
  await matrix.getByRole("button", { name: "Choose Not attending for every available day", exact: true }).click();
  const firstDay = matrix.getByRole("radio", { name: "In person — Workshop day 1", exact: true });
  await matrix
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "In person — Workshop day 1", exact: true }) })
    .click({ position: { x: 4, y: 4 } });
  await expect(firstDay).toBeChecked();
  await matrix.getByRole("radio", { name: "Not attending — Workshop day 1", exact: true }).check();
  await expect(firstDay).not.toBeChecked();
  await matrix
    .locator("label")
    .filter({ has: page.getByRole("radio", { name: "In person — Workshop day 1", exact: true }) })
    .click({ position: { x: 4, y: 4 } });
  await page.goBack();
  await expect(registrationPage.getByText("Representation", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(firstDay).toBeChecked();
  await registrationPage.getByRole("button", { name: "Continue", exact: true }).click();
  await registrationPage.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    registrationPage.locator("[data-registration-review]").getByText("Not attending", { exact: true }),
  ).toHaveCount(6);
  await registrationPage.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    registrationPage.getByRole("checkbox", { name: "I agree to the privacy policy", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(registrationPage.getByText("Too small:", { exact: false })).toHaveCount(0);
  await expect(registrationPage.locator('[data-step="4"]')).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`registration-consent-error-${device}.png`) });
  }
  await page.goBack();
  await expect(registrationPage.getByText("No additional questions.", { exact: true })).toBeVisible();
  await page.goForward();
  await registrationPage.getByRole("checkbox", { name: "I agree to the privacy policy", exact: true }).check();
  await registrationPage.getByRole("checkbox", { name: "I agree to the code of conduct", exact: true }).check();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${event.slug}/registrations` &&
      response.request().method() === "POST",
  );
  const beforeConfirmationEmail = await capturedEmailCount();
  await registrationPage.getByRole("button", { name: "Register", exact: true }).click();
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
  await expect(registrationPage).not.toBeVisible();
  expect(challenged).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "No ticket yet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Registration details", exact: true })).toBeVisible();
  await expect(page.locator("[data-og-badge-img]")).toHaveCount(0);
  const badgeFrame = page.frameLocator("iframe.pk-badge-face__frame");
  await badgeFrame.getByRole("button", { name: "Enlarge check-in code", exact: true }).click();
  const codeViewer = page.getByRole("dialog", { name: "Check-in code", exact: true });
  await expect(codeViewer).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`ticket-qr-${device}.png`), animations: "disabled" });
  }
  await page.goBack();
  await expect(codeViewer).toBeHidden();
  await page.goForward();
  await expect(codeViewer).toBeVisible();
  await codeViewer.getByRole("button", { name: "Close check-in code", exact: true }).click();
  await expect(codeViewer).toBeHidden();
  await page.goto(`/portal/#/events/${event.slug}/promotion`);
  await expect(page.getByRole("heading", { name: "Share", exact: true })).toBeVisible();
  const socialBadge = page.locator("[data-og-badge-img]");
  await expect(socialBadge).toHaveAttribute("src", new RegExp(`layout=${PERSONAL_PROMOTION_RENDERER}`));
  await expect
    .poll(() => socialBadge.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    .toBe(true);
  await expect(page.getByRole("button", { name: "Download badge (PNG)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Download badge formats", exact: true }).click();
  const squareDownload = page.getByRole("menuitem", { name: "Square badge (PNG)", exact: true });
  const downloaded = page.waitForEvent("download");
  await squareDownload.click();
  const squareFile = await downloaded;
  expect(squareFile.suggestedFilename()).toMatch(/-square\.png$/u);
  const squareBytes = await readFile((await squareFile.path())!);
  const squareMetadata = await sharp(squareBytes).metadata();
  expect({ width: squareMetadata.width, height: squareMetadata.height }).toEqual({ width: 1080, height: 1080 });
  await info.attach("square-social-badge", { body: squareBytes, contentType: "image/png" });
  const agendaBase = `/api/v1/events/${event.slug}/agenda`;
  const roomResponse = await page.request.post(`${agendaBase}/rooms`, {
    data: agendaRoomCreateSchema.parse({
      expectedRevision: 0,
      name: "Virtual hall",
      capacity: null,
      equipment: ["live_streaming"],
    }),
  });
  expect(roomResponse.status(), await roomResponse.text()).toBe(200);
  let agenda = agendaSnapshotSchema.parse(await roomResponse.json());
  const sessionResponse = await page.request.post(`${agendaBase}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      roomId: agenda.rooms[0].id,
      title: "Synthetic opening session",
      startAt: `${dayDate}T09:00:00.000Z`,
      endAt: `${dayDate}T10:00:00.000Z`,
    }),
  });
  expect(sessionResponse.status(), await sessionResponse.text()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await sessionResponse.json());
  const publication = await page.request.post(`${agendaBase}/publications`, {
    data: { expectedRevision: agenda.revision },
  });
  expect(publication.status(), await publication.text()).toBe(200);
  await page.goto(`/portal/#/events/${event.slug}/virtual`);
  await expect(page.getByRole("timer")).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`virtual-waiting-${device}.png`), animations: "disabled" });
  }
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Questions", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your question", exact: true })).toBeDisabled();
  await page.goto(`/portal/#/events/${event.slug}/promotion`);
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
  await page.getByRole("button", { name: "Create promotion materials", exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/promotion/renders", async (route) => {
    await pending;
    await route.continue();
  });
  const prepare = page.getByRole("button", { name: "Prepare downloads", exact: true });
  await prepare.click();
  await expect(prepare).toHaveAttribute("aria-busy", "true");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`prepare-pending-${device}.png`), animations: "disabled" });
  }
  release();
  await expect(prepare).not.toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Close promotion materials", exact: true }).click();
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
  await page.goto(`/portal/#/events/${event.slug}/ticket`);
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
      .getByRole("textbox", { name: EMAIL_FIRST_COPY.representation.work.label }),
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
  // A seconds-old unverified account must consolidate through proof into this signed-in account.
  const placeholder = await page.request.post("/api/v1/users", {
    data: userCreateSchema.parse({
      email: "ada@lighthouse-work.test",
      firstName: "Unverified",
      lastName: "Placeholder",
    }),
  });
  expect(placeholder.status()).toBe(201);
  await addRepresentation
    .getByRole("textbox", { name: EMAIL_FIRST_COPY.representation.work.label })
    .fill("ada@lighthouse-work.test");
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
  const verificationUrl = extractEmailUrl(verificationEmail, "/portal/");
  const unrelated = await browser.newContext();
  const foreignVerification = await unrelated.newPage();
  await foreignVerification.goto(verificationUrl);
  await foreignVerification.getByRole("button", { name: "Consolidate into my account", exact: true }).click();
  await expect(foreignVerification.getByRole("alert")).toContainText(
    "Sign in to the account that requested this address",
  );
  await expect(
    foreignVerification
      .getByRole("region", { name: "Email verification" })
      .getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await unrelated.close();
  const verification = await page.context().newPage();
  await verification.goto(verificationUrl);
  await expect(verification.getByText(email, { exact: true })).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await verification.setViewportSize({ width, height });
    await verification.screenshot({ path: info.outputPath(`email-consolidation-confirmation-${device}.png`) });
  }
  await verification.getByRole("button", { name: "Consolidate into my account", exact: true }).click();
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
  const eventLink = page
    .getByRole("heading", { name: "Post-Quantum Cryptography Conference", exact: true })
    .getByRole("link", { name: "Post-Quantum Cryptography Conference", exact: true });
  await expect(eventLink).toHaveCSS("color", "rgb(255, 255, 255)");
  await eventLink.hover();
  await expect(eventLink).toHaveCSS("color", "rgb(255, 255, 255)");
  await eventLink.click();
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
  // Changing domains returns through the same verified organization chooser.
  // A fresh domain each run, so no earlier run has already given it an organization.
  const nextEmail = `changed@domain-change-${crypto.randomUUID()}.test`;
  const nextOrganization = `Domain Change Fixture ${crypto.randomUUID().slice(0, 8)}`;
  const beforeEmailChange = await capturedEmailCount();
  await registration.getByRole("button", { name: "Edit details", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(nextEmail);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(registration.getByText(/Check your new email address/)).toBeVisible();
  const changeMessage = await waitForCapturedEmail(nextEmail, "confirm", { since: beforeEmailChange });
  await page.goto(extractEmailUrl(changeMessage, "/register/confirm/"));
  const organizationName = page.getByRole("textbox", { name: /^Organization name/ });
  await expect(organizationName).toBeVisible();
  await organizationName.fill(nextOrganization);
  await page.getByRole("textbox", { name: /^Job title/ }).fill("Engineer");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: testInfo.outputPath(`email-domain-confirmation-${device}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Confirm my registration", exact: true }).click();
  await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible();
  await page.getByRole("link", { name: /Manage registration/ }).click();
  await expect(page.getByText(nextOrganization, { exact: false })).toBeVisible();
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
