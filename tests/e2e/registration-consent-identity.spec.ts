import { submitMembershipApplication } from "./helpers/membership";
import { userCreateSchema } from "../../assets/shared/schemas/user-create";
import { ownEmailAddressAddSchema } from "../../assets/shared/schemas/own-email-addresses";
import { organizationDomainsListResponseSchema } from "../../assets/shared/schemas/organization-domains";
import { geolocationCountryResponseSchema } from "../../assets/shared/schemas/geolocation";
import { mkdir } from "node:fs/promises";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../assets/shared/email-first-copy";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
/** @covers event.3.2.b */
import { expect, test } from "@playwright/test";
import { continueRegistrationWithEmail, ownDomainEmail, registerInBrowser } from "./helpers/registration";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../../assets/shared/schemas/registration";
import { EMAIL_FIRST_COPY, REGISTRATION_ORGANIZATION_COPY } from "../../assets/shared/email-first-copy";
import { userDetailResponseSchema, usersListResponseSchema } from "../../assets/shared/schemas/user-management";
import { userParticipationResponseSchema } from "../../assets/shared/schemas/user-participation";
import {
  groupMailingListCreateSchema,
  mailingListResponseSchema,
  mailingListSubscribersResponseSchema,
} from "../../assets/shared/schemas/mailing-lists";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openMyProfile, signInToPortal } from "./helpers/portal-auth";
import { createMember } from "./helpers/member-provisioning";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

test("verified approved-domain registration affiliates once and an organization identity can be selected for the event", async ({
  page,
  browser,
}, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const representative = await createMember(page, {
    organizationName: `Summit Trust Services ${crypto.randomUUID().slice(0, 6)}`,
  });
  const owner = userDetailResponseSchema.parse(
    await (await page.request.get(`/api/v1/users/${representative.userId}`)).json(),
  );
  const ownerIdentity = owner.user.identities.find((identity) => identity.organizationId !== null)!;
  const organizationName = ownerIdentity.organizationName!;
  const email = `event-${Date.now()}@${representative.email.split("@")[1]}`;
  const listResponse = await page.request.post("/api/v1/groups/pkic/mailing-lists", {
    data: groupMailingListCreateSchema.parse({
      email: `consent-${Date.now()}@lists.example.test`,
      label: "Consent verification",
      purpose: "custom",
      subscriptionDefault: "group_members",
      postingPolicy: "subscribers",
      moderationPolicy: "moderated",
      active: true,
    }),
  });
  expect(listResponse.status(), await listResponse.text()).toBe(201);
  const listId = mailingListResponseSchema.parse(await listResponse.json()).mailingList.id;
  const subscribers = async () =>
    mailingListSubscribersResponseSchema.parse(
      await (
        await page.request.get(`/api/v1/groups/pkic/mailing-lists/${listId}/subscribers?q=${encodeURIComponent(email)}`)
      ).json(),
    );
  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const attendee = await attendeeContext.newPage();
  try {
    const since = await capturedEmailCount();
    const initial = await registerInBrowser(attendee, email, undefined, undefined, {
      onAttendanceReady: async (formPage) => {
        const choices = formPage.getByRole("group", { name: "Attendance choices", exact: true });
        await formPage.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
        for (const [width, height, device] of [
          [1280, 900, "desktop"],
          [375, 812, "phone"],
        ] as const) {
          await formPage.setViewportSize({ width, height });
          await choices.scrollIntoViewIfNeeded();
          const target = choices
            .locator("label")
            .filter({ has: formPage.getByRole("radio", { checked: true }) })
            .first();
          const bounds = await target.boundingBox();
          expect(bounds!.width).toBeGreaterThanOrEqual(44);
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(await target.evaluate((element) => getComputedStyle(element.closest("td")!).backgroundColor)).not.toBe(
            "rgba(0, 0, 0, 0)",
          );
          await formPage.screenshot({
            path: testInfo.outputPath(`public-attendance-spacing-${device}.png`),
            animations: "disabled",
          });
        }
      },
      onReviewReady: async (formPage) => {
        const review = formPage.getByRole("region", { name: "Registration review", exact: true });
        await expect(review.getByRole("button", { name: "Edit contact", exact: true })).toBeVisible();
        await formPage.setViewportSize({ width: 1280, height: 900 });
        await review.scrollIntoViewIfNeeded();
        await formPage.screenshot({ path: testInfo.outputPath("registration-review-desktop.png") });
        await formPage.setViewportSize({ width: 375, height: 812 });
        await review.scrollIntoViewIfNeeded();
        await formPage.screenshot({ path: testInfo.outputPath("registration-review-phone.png") });
      },
      onContactReady: async (formPage) => {
        await expect(formPage.locator('[aria-invalid="true"]')).toHaveCount(0);
        const first = formPage.getByRole("textbox", { name: /^First name/ });
        const last = formPage.getByRole("textbox", { name: /^Last name/ });
        await first.fill("");
        await last.fill("");
        await formPage.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(first).toBeFocused();
        await first.fill("Synthetic");
        await last.fill("Attendee");
        const chooser = formPage.getByRole("combobox", { name: /^Organization/ });
        await expect(chooser).toHaveValue(ownerIdentity.organizationId!);
        await formPage.setViewportSize({ width: 1280, height: 900 });
        await formPage.screenshot({ path: testInfo.outputPath("public-organization-choice-desktop.png") });
        await formPage.setViewportSize({ width: 375, height: 812 });
        await formPage.screenshot({ path: testInfo.outputPath("public-organization-choice-phone.png") });
        await formPage.getByRole("button", { name: "Add organization", exact: true }).click();
        const addOrganization = formPage.getByRole("dialog", { name: "Add organization", exact: true });
        await expect(addOrganization.getByRole("textbox", { name: /^Organization name/ })).toBeVisible();
        await formPage.setViewportSize({ width: 1280, height: 900 });
        await formPage.screenshot({ path: testInfo.outputPath("public-add-organization-desktop.png") });
        await formPage.setViewportSize({ width: 375, height: 812 });
        await formPage.screenshot({ path: testInfo.outputPath("public-add-organization-phone.png") });
        await formPage.goBack();
        await expect(addOrganization).not.toBeVisible();
        await formPage.goForward();
        await expect(addOrganization).toBeVisible();
        await addOrganization.getByRole("button", { name: "Close add organization", exact: true }).click();
        await expect(addOrganization).not.toBeVisible();
        await expect(chooser).toHaveValue(ownerIdentity.organizationId!);
      },
    });
    expect(initial.request.identityId).toBeUndefined();
    // The verified domain supplies the default; the registrant sees and confirms the organization.
    expect(initial.result.status).toBe("registered");
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const confirmedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since });
    const manageUrl = extractEmailUrl(confirmedEmail, "/register/manage/");
    const users = usersListResponseSchema.parse(
      await (await page.request.get(`/api/v1/users?q=${encodeURIComponent(email)}`)).json(),
    );
    const userId = users.users.find((user) => user.email === email)!.id;
    const detail = userDetailResponseSchema.parse(await (await page.request.get(`/api/v1/users/${userId}`)).json());
    // The approved work domain adds one organization identity alongside the personal identity.
    expect(detail.user.identities).toEqual([
      expect.objectContaining({ organizationId: null, organizationName: null, memberId: null }),
      expect.objectContaining({ organizationName, status: "active" }),
    ]);
    const participation = userParticipationResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${userId}/participation`)).json(),
    );
    expect(participation.participation.summary.groupCount).toBeGreaterThan(0);
    expect((await subscribers()).subscribers).toMatchObject([{ subscribed: true }]);
    await attendee.screenshot({
      path: testInfo.outputPath("event-confirmed-with-domain-affiliation.png"),
      fullPage: true,
    });

    // An affiliated member receives sign-in guidance, not a new join capability.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sinceJoin = await capturedEmailCount();
      await attendee.goto("/join/");
      await attendee.getByLabel(EMAIL_FIRST_COPY.join.work.label).fill(email);
      await attendee.getByRole("button", { name: EMAIL_FIRST_COPY.join.work.action, exact: true }).click();
      await expect(attendee.getByText("Check your email", { exact: true })).toBeVisible();
      const joinEmail = await waitForCapturedEmail(email, "already have PKI Consortium member access", {
        since: sinceJoin,
      });
      expect(new URL(extractEmailUrl(joinEmail, "/portal/")).pathname).toBe("/portal/");
    }
    await signInToPortal(attendee, email, { continueAs: organizationName });
    await expect(attendee.getByRole("navigation", { name: "Portal navigation" })).toBeVisible();
    // Joining again reuses the automatically created organization identity.
    const activeIdentities = async () =>
      identitiesListResponseSchema.parse(
        await (await attendee.request.get("/api/v1/users/current/identities?active=true")).json(),
      ).identities;
    const joined = await activeIdentities();
    expect(joined.filter((entry) => entry.organizationId === null)).toHaveLength(1);
    const organizationIdentities = joined.filter((entry) => entry.organizationId !== null);
    expect(organizationIdentities).toHaveLength(1);
    expect(organizationIdentities[0]!.organizationName).toBe(organizationName);
    expect(organizationIdentities[0]!.id).toBe(
      detail.user.identities.find((identity) => identity.organizationId !== null)!.identityId,
    );
    expect((await subscribers()).subscribers).toMatchObject([{ subscribed: true }]);
    await attendee.goto(manageUrl);
    await attendee.getByRole("button", { name: "Cancel my registration…", exact: true }).click();
    await acceptConfirmDialog(attendee, "Cancel registration");
    await expect(attendee.getByRole("heading", { name: "Registration cancelled", exact: true })).toBeVisible();
    const sinceSelected = await capturedEmailCount();
    const selected = await registerInBrowser(attendee, email, organizationName);
    expect(selected.request.identityId).toBe(organizationIdentities[0]!.id);
    expect(selected.result.registrationId).toBe(initial.result.registrationId);
    expect(selected.result.status).toBe("registered");
    await expect(attendee.getByRole("heading", { name: /You're registered/i })).toBeVisible();
    const selectedEmail = await waitForCapturedEmail(email, "registration is confirmed", { since: sinceSelected });
    await attendee.goto(extractEmailUrl(selectedEmail, "/register/manage/"));
    await attendee.getByRole("button", { name: "Change representation", exact: true }).click();
    const changeIdentity = attendee.getByRole("dialog", { name: "Change representation", exact: true });
    await changeIdentity.getByRole("combobox", { name: /^Representation/ }).click();
    await attendee.getByRole("option").filter({ hasText: "Personal" }).click();
    for (const [width, height, device] of [
      [1280, 900, "desktop"],
      [375, 812, "phone"],
    ] as const) {
      await attendee.setViewportSize({ width, height });
      await attendee.screenshot({ path: testInfo.outputPath(`public-update-identity-${device}.png`) });
    }
    await changeIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
    const addIdentity = attendee.getByRole("dialog", { name: "Add identity", exact: true });
    await expect(addIdentity.getByRole("textbox", { name: EMAIL_FIRST_COPY.representation.work.label })).toBeVisible();
    await attendee.screenshot({ path: testInfo.outputPath("public-update-add-identity-phone.png") });
    await addIdentity.getByRole("button", { name: "Cancel", exact: true }).click();
    // The page reloads itself after saving. Wait for that document instead of
    // racing it with a second reload, which aborts navigation in CI.
    const saveRepresentation = async () => {
      const reloaded = attendee.waitForEvent("domcontentloaded");
      await changeIdentity.getByRole("button", { name: "Save changes", exact: true }).click();
      await reloaded;
      await expect(changeIdentity).not.toBeVisible();
    };
    await saveRepresentation();
    await attendee.getByRole("button", { name: "Change representation", exact: true }).click();
    await expect(changeIdentity.getByRole("combobox", { name: /^Representation/ })).toContainText("Personal");
    await changeIdentity.getByRole("combobox", { name: /^Representation/ }).click();
    await attendee.getByRole("option").filter({ hasText: organizationName }).click();
    await saveRepresentation();
    // Profile edits preserve the independently selected registration representation.
    await expect(attendee.getByRole("definition").filter({ hasText: organizationName })).toBeVisible();
    await attendee.getByRole("button", { name: "Edit details", exact: true }).click();
    await expect(attendee.getByRole("textbox", { name: /^Organization/ })).toHaveCount(0);
    await expect(attendee.getByRole("link", { name: "Manage identities", exact: true })).toBeVisible();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("US");
    await attendee.getByLabel("Country", { exact: true }).selectOption("CA");
    await attendee.goBack();
    await expect(attendee.getByRole("button", { name: "Edit details", exact: true })).toBeVisible();
    await attendee.goForward();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("CA");
    const savedResponse = attendee.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith("/api/v1/registrations/access/") &&
        response.request().method() === "PATCH",
    );
    await attendee.getByRole("button", { name: "Save changes", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    expect(registrationManageSchema.parse(saved.request().postDataJSON())).toMatchObject({
      action: "update",
      customAnswers: { country: "CA" },
    });
    registrationManageUpdateResponseSchema.parse(await saved.json());
    await expect(attendee.getByRole("heading", { name: "Changes saved", exact: true })).toBeVisible();
    await attendee.reload();
    await attendee.getByRole("button", { name: "Edit details", exact: true }).click();
    await expect(attendee.getByLabel("Country", { exact: true })).toHaveValue("CA");
    const badge = attendee.locator("[data-og-badge-img]");
    await expect(badge).toHaveAttribute("src", /[?&]v=/);
    await expect
      .poll(() => badge.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true);
    // This quiet strip between the name and portrait must contain photo detail, not just a smooth fallback gradient.
    const photoDetail = await badge.evaluate((element: HTMLImageElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const context = canvas.getContext("2d")!;
      context.drawImage(element, 0, 0, 1200, 630);
      const { data } = context.getImageData(740, 140, 1, 300);
      let detail = 0;
      let samples = 0;
      for (let y = 5; y < 295; y += 5)
        for (let channel = 0; channel < 3; channel++) {
          detail += Math.abs(data[(y - 5) * 4 + channel] - 2 * data[y * 4 + channel] + data[(y + 5) * 4 + channel]);
          samples++;
        }
      return detail / samples;
    });
    expect(photoDetail, "The delivered badge must include the configured event photo").toBeGreaterThan(5);
    await badge.screenshot({ path: testInfo.outputPath("selected-identity-badge.png") });
    await attendee.screenshot({ path: testInfo.outputPath("registration-selected-identity.png"), fullPage: true });
    await attendee.setViewportSize({ width: 375, height: 812 });
    await attendee.screenshot({
      path: testInfo.outputPath("registration-selected-identity-phone.png"),
      fullPage: true,
    });
  } finally {
    await attendeeContext.close();
  }
});

test("a proved work address requires organization confirmation and an incorrect shared-domain representation can be removed", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  await signInToPortal(page, e2eAdminEmail("representation-onboarding"));
  await openMyProfile(page);
  const stamp = Date.now();
  const domain = `shared-representation-${stamp}.example`;
  const names = [`Northstar Trust ${String(stamp).slice(-5)}`, `Northstar US ${String(stamp).slice(-5)}`];
  const directory = info.outputPath("representation-flow");
  await mkdir(directory, { recursive: true });
  for (const [index, name] of names.entries()) {
    const email = `person-${index}@${index === 1 ? `us.${domain}` : domain}`;
    await page.getByRole("button", { name: "Add identity", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add identity", exact: true });
    await expect(dialog.getByRole("radio", { name: /Use your work email/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /Use a personal email/ })).not.toBeChecked();
    await page.setViewportSize({ width: 1280, height: 900 });
    if (index === 0) await page.screenshot({ path: `${directory}/email-choice-desktop.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    if (index === 0) await page.screenshot({ path: `${directory}/email-choice-phone.png` });
    await dialog.getByLabel(EMAIL_FIRST_COPY.representation.work.label, { exact: true }).fill(email);
    const since = await capturedEmailCount();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toContainText("Open the verification email");
    const message = await waitForCapturedEmail(email, "Verify your email", { since });
    const verificationPage = await page.context().newPage();
    await verificationPage.goto(extractEmailUrl(message, "/email-verifications"));
    await verificationPage.getByRole("button", { name: "Verify this address", exact: true }).click();
    await expect(verificationPage.getByText(`${email} is verified`, { exact: true })).toBeVisible();
    await verificationPage.close();
    // Proof links the address; it does not silently assign the domain's organization.
    const before = identitiesListResponseSchema.parse(
      await (await page.request.get("/api/v1/users/current/identities?limit=100")).json(),
    );
    expect(before.identities.some((identity) => identity.email === email)).toBe(false);
    await dialog.getByRole("button", { name: "Check verification", exact: true }).click();
    if (index === 1) {
      const organization = dialog.getByRole("combobox", { name: /^Organization/ });
      await expect(organization).toHaveValue(
        before.identities.find((identity) => identity.organizationName === names[0])!.organizationId!,
      );
    }
    if (index === 0) {
      await expect(dialog.getByRole("combobox", { name: /^Organization/ })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Add organization", exact: true })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Add representation", exact: true }).click();
      const organizationName = dialog.getByRole("textbox", { name: /^Organization name/ });
      await expect(organizationName).toHaveAttribute("aria-invalid", "true");
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: `${directory}/organization-required-desktop.png` });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ path: `${directory}/organization-required-phone.png` });
      await organizationName.fill(name);
    } else {
      await dialog.getByRole("button", { name: "Add organization", exact: true }).click();
      const addOrganization = page.getByRole("dialog", { name: "Add organization", exact: true });
      await addOrganization.getByRole("textbox", { name: /^Organization name/ }).fill(name);
      const scope = addOrganization.getByRole("combobox", { name: "Email domain", exact: true });
      await expect(scope).toHaveValue(`us.${domain}`);
      await scope.selectOption(domain);
      await expect(addOrganization.getByRole("textbox", { name: /^Organization name/ })).toHaveValue(name);
      await scope.selectOption(`us.${domain}`);
      await expect(addOrganization.getByRole("textbox", { name: /^Organization name/ })).toHaveValue(name);
      await addOrganization.getByRole("button", { name: "Use organization", exact: true }).click();
      await expect(addOrganization).not.toBeVisible();
    }
    await dialog
      .getByRole("textbox", { name: new RegExp(`^${ORGANIZATION_JOB_TITLE_COPY.label}`) })
      .fill("Research engineer");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${directory}/organization-${index}-desktop.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${directory}/organization-${index}-phone.png` });
    await dialog.getByRole("button", { name: "Add representation", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("article").filter({ has: page.getByText(name, { exact: true }) })).toBeVisible();
  }
  const identities = identitiesListResponseSchema.parse(
    await (await page.request.get("/api/v1/users/current/identities?limit=100")).json(),
  );
  const original = identities.identities.find((identity) => identity.organizationName === names[0])!;
  const replacementEmail = `corrected@${domain}`;
  const sinceReplacement = await capturedEmailCount();
  const requestedEmail = await page.request.post("/api/v1/users/current/emails", {
    data: ownEmailAddressAddSchema.parse({ email: replacementEmail }),
  });
  expect(requestedEmail.status(), await requestedEmail.text()).toBe(202);
  const replacementMessage = await waitForCapturedEmail(replacementEmail, "Verify your email", {
    since: sinceReplacement,
  });
  const replacementPage = await page.context().newPage();
  await replacementPage.goto(extractEmailUrl(replacementMessage, "/email-verifications"));
  await replacementPage.getByRole("button", { name: "Verify this address", exact: true }).click();
  await expect(replacementPage.getByText(`${replacementEmail} is verified`, { exact: true })).toBeVisible();
  await replacementPage.close();
  await page.getByRole("button", { name: `Actions for ${names[0]}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Change representation email…", exact: true }).click();
  const emailDialog = page.getByRole("dialog", { name: "Change representation email", exact: true });
  await emailDialog.getByRole("combobox", { name: /^Representation email/ }).click();
  await expect(page.getByRole("option", { name: e2eAdminEmail("representation-onboarding"), exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("option", { name: replacementEmail, exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${directory}/representation-email-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${directory}/representation-email-phone.png` });
  await page.goBack();
  await expect(emailDialog).not.toBeVisible();
  await page.goForward();
  await expect(emailDialog).toBeVisible();
  await emailDialog.getByRole("button", { name: "Save email", exact: true }).click();
  await expect(emailDialog).not.toBeVisible();
  const corrected = identitiesListResponseSchema
    .parse(await (await page.request.get("/api/v1/users/current/identities?limit=100")).json())
    .identities.find((identity) => identity.id === original.id)!;
  expect(corrected.organizationId).toBe(original.organizationId);
  expect(corrected.jobTitle).toBe(original.jobTitle);
  expect(corrected.emailId).not.toBeNull();
  expect(corrected.email).toBe(replacementEmail);
  const incorrect = identities.identities.find((identity) => identity.organizationName === names[1])!;
  const domains = organizationDomainsListResponseSchema.parse(
    await (await page.request.get(`/api/v1/organizations/${incorrect.organizationId}/domains`)).json(),
  );
  expect(domains.domains).toContainEqual(expect.objectContaining({ domain: `us.${domain}`, status: "claimed" }));
  await page.goto(`/portal/#/organizations/${incorrect.organizationId}`);
  await expect(page.getByText("Organizations connected by email domain", { exact: true })).toBeVisible();
  await expect(page.getByText(names[0], { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("heading", { name: "Email domain connections", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/related-organizations-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("heading", { name: "Email domain connections", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/related-organizations-phone.png` });
  await openMyProfile(page);
  await page.getByRole("button", { name: `Actions for ${names[1]}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Correct identity…", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Correct identity", exact: true });
  await correction.getByRole("combobox", { name: /^Representation/ }).click();
  await page.getByRole("option", { name: new RegExp(names[0]) }).click();
  await correction
    .getByRole("textbox", { name: /^Reason for correction/ })
    .fill("The subsidiary was selected by mistake.");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${directory}/correct-organization-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${directory}/correct-organization-phone.png` });
  await page.goBack();
  await expect(correction).not.toBeVisible();
  await page.goForward();
  await expect(correction).toBeVisible();
  await expect(correction.getByRole("textbox", { name: /^Reason for correction/ })).toHaveValue(
    "The subsidiary was selected by mistake.",
  );
  await correction.getByRole("button", { name: "Correct identity", exact: true }).click();
  await expect(correction).not.toBeVisible();
  await expect(page.getByRole("article").filter({ has: page.getByText(names[1], { exact: true }) })).toHaveCount(0);
  const session = userAuthSessionResponseSchema.parse(await (await page.request.get("/api/v1/auth/session")).json());
  const detail = userDetailResponseSchema.parse(
    await (await page.request.get(`/api/v1/users/${session.identity.id}`)).json(),
  );
  expect(
    [...detail.user.identities, ...detail.user.formerIdentities].some(
      (identity) => identity.identityId === incorrect.id,
    ),
  ).toBe(false);
  await expect(page.getByRole("article").filter({ has: page.getByText(names[0], { exact: true }) })).toBeVisible();
  await page.route("**/api/v1/geolocation/country", (route) =>
    route.fulfill({ json: geolocationCountryResponseSchema.parse({ country: "NL" }) }),
  );
  await page.goto("/events/2026/pqc-conference-amsterdam-nl/register/");
  await continueRegistrationWithEmail(page, {
    email: e2eAdminEmail("representation-onboarding"),
    firstName: "Ada",
    lastName: "Example",
  });
  await page.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const country = page.getByRole("combobox", { name: /^Country/ });
  await expect(country).toHaveValue("NL");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${directory}/country-default-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${directory}/country-default-phone.png` });
  await country.selectOption("CA");
  await page.goBack();
  await page.goForward();
  await expect(country).toHaveValue("CA");
});

test("a pending membership domain can register while affiliation awaits review", async ({ page }, info) => {
  const applicant = ownDomainEmail("pending-membership");
  const name = "Pending Membership Research";
  await submitMembershipApplication(page, {
    email: applicant,
    name: "Casey Applicant",
    category: "A",
    organizationName: name,
  });
  const email = `attendee@${applicant.split("@")[1]}`;
  const registration = await registerInBrowser(page, email, undefined, undefined, {
    organization: name,
    onContactReady: async (contact) => {
      await expect(contact.getByRole("textbox", { name: /^Organization name/ })).toHaveAccessibleDescription(
        REGISTRATION_ORGANIZATION_COPY.pendingReviewHelp,
      );
      for (const [width, height, device] of [
        [1280, 900, "desktop"],
        [375, 812, "phone"],
      ] as const) {
        await contact.setViewportSize({ width, height });
        await contact.getByRole("textbox", { name: /^Organization name/ }).scrollIntoViewIfNeeded();
        await contact.screenshot({ path: info.outputPath(`pending-affiliation-contact-${device}.png`) });
      }
    },
  });
  expect(registration.result).toMatchObject({ status: "registered", organizationOutcome: "review_required" });
  await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByText(REGISTRATION_ORGANIZATION_COPY.reviewRequired, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`pending-affiliation-success-${device}.png`) });
  }
});

test("a verified new work domain shows organization fields directly in public registration", async ({
  page,
}, testInfo) => {
  const name = "New Domain Research";
  const detected = geolocationCountryResponseSchema.parse(
    await (await page.request.get("/api/v1/geolocation/country")).json(),
  ).country;
  expect(detected).toMatch(/^[A-Z]{2}$/);
  const result = await registerInBrowser(page, ownDomainEmail("new-organization"), undefined, undefined, {
    organization: name,
    onProfileReady: async (formPage) => {
      const country = formPage.getByLabel("Country", { exact: true });
      await expect(country).toHaveValue(detected!);
      for (const [width, height, device] of [
        [1280, 900, "desktop"],
        [375, 812, "phone"],
      ] as const) {
        await formPage.setViewportSize({ width, height });
        await country.scrollIntoViewIfNeeded();
        await formPage.screenshot({ path: testInfo.outputPath(`public-detected-country-${device}.png`) });
      }
      await country.selectOption("CA");
      await formPage.goBack();
      await expect(country).not.toBeVisible();
      await formPage.goForward();
      await expect(country).toHaveValue("CA");
    },
    onContactReady: async (formPage) => {
      const organization = formPage.getByRole("textbox", { name: /^Organization name/ });
      await expect(formPage.getByRole("combobox", { name: /^Organization/ })).toHaveCount(0);
      await expect(formPage.getByRole("button", { name: "Add organization", exact: true })).toHaveCount(0);
      await organization.fill("");
      await formPage.locator("[data-event-registration] [data-step-next]").click();
      await expect(organization).toHaveAttribute("aria-invalid", "true");
      for (const [width, height, device] of [
        [1280, 900, "desktop"],
        [375, 812, "phone"],
      ] as const) {
        await formPage.setViewportSize({ width, height });
        await organization.scrollIntoViewIfNeeded();
        await formPage.screenshot({ path: testInfo.outputPath(`public-new-organization-${device}.png`) });
      }
      const field = organization.locator("..");
      const inputBox = await organization.boundingBox();
      const iconBox = await field.locator(".pk-field__state").boundingBox();
      expect(inputBox).not.toBeNull();
      expect(iconBox).not.toBeNull();
      expect(iconBox!.x).toBeGreaterThan(inputBox!.x);
      expect(iconBox!.x + iconBox!.width).toBeLessThan(inputBox!.x + inputBox!.width);
      await organization.fill(name);
    },
  });
  expect(result.result.status).toBe("registered");
  await expect(page.getByRole("heading", { name: /You're registered/i })).toBeVisible();
});

test("a legacy saved name can be corrected before completing public registration", async ({ page, browser }, info) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-management"));
  const email = ownDomainEmail("unicode-name");
  const created = await page.request.post("/api/v1/users", {
    data: userCreateSchema.parse({ email, firstName: "Ada", lastName: "Fixture" }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const attendee = await context.newPage();
  // Simulate legacy stored text at the tolerant read boundary; the save and registration use the real Worker.
  await attendee.route("**/registrations/proof/verify", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.person.firstName = "ZoÃ«";
    await route.fulfill({ response, json: body });
  });
  try {
    await registerInBrowser(attendee, email, undefined, undefined, {
      organization: "Unicode Trust Services",
      onContactReady: async (current) => {
        await current.getByRole("button", { name: "Continue", exact: true }).click();
        const editor = current.getByRole("dialog", { name: "Edit my details", exact: true });
        await expect(editor).toBeVisible();
        await expect(editor).toContainText("Check your first name");
        for (const [width, height, device] of [
          [1280, 900, "desktop"],
          [375, 812, "phone"],
        ] as const) {
          await current.setViewportSize({ width, height });
          await current.screenshot({ path: info.outputPath(`name-correction-${device}.png`) });
        }
        // Browser Back dismisses the editor without abandoning the registration.
        await current.goBack();
        await expect(editor).not.toBeVisible();
        await current.goForward();
        await expect(editor).toBeVisible();
        await editor.getByRole("textbox", { name: /^First name/ }).fill("Zoë");
        await editor.getByRole("button", { name: "Save my details", exact: true }).click();
        await expect(editor).not.toBeVisible();
        await expect(current.locator("[data-registration-contact]")).toContainText("Zoë Fixture");
      },
      onReviewReady: async (current) => {
        await expect(current.getByRole("region", { name: "Registration review", exact: true })).toContainText(
          "Zoë Fixture",
        );
        await current.screenshot({ path: info.outputPath("corrected-name-review.png"), animations: "disabled" });
      },
    });
    const users = usersListResponseSchema.parse(
      await (await page.request.get(`/api/v1/users?q=${encodeURIComponent(email)}`)).json(),
    );
    expect(users.users.find((user) => user.email === email)?.first_name).toBe("Zoë");
  } finally {
    await context.close();
  }
});
