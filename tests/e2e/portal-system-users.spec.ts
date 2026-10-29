import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { scopedAuditLogResponseSchema } from "../../assets/shared/schemas/audit-log";
import { eventRegistrationsListResponseSchema } from "../../assets/shared/schemas/event-registrations";
import {
  organizationCreateSchema,
  organizationCreateResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../assets/shared/schemas/identity";
import { registrationIdentityChangeSchema } from "../../assets/shared/schemas/registration-identity";
import { registrationManageReadResponseSchema } from "../../assets/shared/schemas/registration";
import { userUpdateSchema, userDetailResponseSchema } from "../../assets/shared/schemas/user-management";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { agreeToHeadshotTerms, chooseHeadshotThroughUploadButton } from "./helpers/headshot-upload";

/*
 * Staff putting a photograph on somebody else's record.
 *
 * The member's own upload has been walked for a while; the staff one never
 * was, and it was reported as simply not working. Both run the same controller
 * and the same two dialogs, but through a different manager and a different
 * endpoint, so the coverage of one said nothing about the other.
 */
test("staff view a user's participation history and upload a photograph", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `staff-headshot-${suffix}@staff-headshot-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-user-headshot"));
  await approveMemberThroughReview(page, {
    email,
    name: `Staff Headshot ${suffix}`,
    organizationName: `Staff Headshot Org ${suffix}`,
  });

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  // The list names people; their address is searched for, not shown.
  const row = page.locator("tr").filter({ hasText: `Staff Headshot ${suffix}` });
  await expect(row).toBeVisible();
  const eventsLoaded = page.waitForResponse((response) =>
    /\/api\/v1\/users\/[^/]+\/(?:participation\/)?events$/.test(new URL(response.url()).pathname),
  );
  await row.click();
  expect((await eventsLoaded).status()).toBe(200);
  const participation = page.getByRole("tabpanel").filter({ hasText: "Events appear here as they are attended." });
  await expect(participation).toBeVisible();
  for (const [tab, collection, empty] of [
    ["Meetings", "meetings", "Meetings appear here as they are joined."],
    ["Documents", "documents", "Uploads and reviews appear here."],
    ["Votes", "votes", "Ballots appear here as they are cast."],
  ]) {
    const loaded = page.waitForResponse((response) =>
      new RegExp(`/api/v1/users/[^/]+/(?:participation/)?${collection}$`).test(new URL(response.url()).pathname),
    );
    await page.getByRole("tab", { name: tab, exact: true }).click();
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole("tabpanel").getByText(empty, { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/user-participation-${collection}.png`, fullPage: true });
  }

  /*
   * The portrait is the control, in the open at the top of the record (#28).
   * It used to be an upload button behind a disclosure, which is what the
   * issue objected to: a photograph is not administration, and nobody looks
   * for their own face under that heading.
   *
   * Through the tile and the picker it opens: reaching past it to the input is
   * what let #28 hide here before. See helpers/headshot-upload.ts.
   */
  await chooseHeadshotThroughUploadButton(page);

  const crop = await agreeToHeadshotTerms(page);
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/[^/]+\/headshot$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  /*
   * And the portal shows it back, which is the half that was reported as
   * working publicly but not here. Two projections serve the same photograph:
   * the record's own detail builds the staff-only `/headshot` path, the users
   * list builds the public `/headshots/{file}` one — so the assertion accepts
   * either rather than pinning the reader to one of them.
   */
  const portrait = page.locator('img[src*="/headshot"]').first();
  await expect(portrait).toBeVisible({ timeout: 15_000 });
  // Visible is not the same as loaded: a broken image still occupies its box,
  // and a 404 from the image endpoint is exactly the reported symptom.
  await expect
    .poll(async () => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const frame = page.getByRole("button", { name: /^Change photo of / });
  const frameBox = (await frame.boundingBox())!;
  const imageBox = (await portrait.boundingBox())!;
  expect(Math.abs(imageBox.width - imageBox.height), "photo stays square").toBeLessThan(1);
  expect(Math.abs(frameBox.width - imageBox.width), "photo fills its circular frame").toBeLessThanOrEqual(2);
  await expect(portrait).toHaveCSS("object-fit", "cover");
  // #85: the editor's actions never sit in a ring of their own. The record
  // carries no account standing on its portrait, so there is no ring at all;
  // the remove action appears with focus, at the portrait's own corner.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".pk-avatar-standing")).toHaveCount(0);
    const pictureBox = (await frame.boundingBox())!;
    expect(Math.abs(pictureBox.width - pictureBox.height), "photo frame stays circular").toBeLessThan(1);
    await frame.focus();
    await expect(page.getByRole("button", { name: /^Remove photo of / })).toBeVisible();
    const removeBox = (await page.getByRole("button", { name: /^Remove photo of / }).boundingBox())!;
    expect(removeBox.y, "remove is at the portrait corner, not a separate row").toBeLessThan(pictureBox.y + 10);
    await page.screenshot({ path: `test-results/issue-85-portrait-${width}.png` });
  }
});

test("staff read registration and account changes through the shared audit tables", async ({ page, browser }, info) => {
  await signInToPortal(page, e2eAdminEmail("portal-account-audit"));
  const fixture = await createRegistrationEvent(page, "audit-history");
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const attendee = await context.newPage();
    const email = `audit-${crypto.randomUUID()}@synthetic-audit.test`;
    await registerStateAttendee(attendee, fixture, email, { staticRelease: false });
    const rosterResponse = await page.request.get(`/api/v1/events/${fixture.slug}/registrations`, {
      params: { q: email },
    });
    expect(rosterResponse.status()).toBe(200);
    const record = eventRegistrationsListResponseSchema.parse(await rosterResponse.json()).registrations[0];
    expect(record).toBeDefined();
    const updated = await page.request.patch(`/api/v1/users/${record!.user_id}`, {
      data: userUpdateSchema.parse({ firstName: "Audit example" }),
    });
    expect(updated.status()).toBe(200);

    await page.goto(`/portal/#/events/${fixture.slug}/registrations/detail/${record!.id}`);
    const historyLoaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/registrations/${record!.id}/audit`),
    );
    await page.getByRole("tab", { name: "Audit log", exact: true }).click();
    const historyResponse = await historyLoaded;
    expect(historyResponse.status()).toBe(200);
    const history = scopedAuditLogResponseSchema.parse(await historyResponse.json());
    expect(history.auditLog.length).toBeGreaterThan(0);
    const registrationHistory = page.getByRole("table", { name: "Registration history", exact: true });
    await expect(registrationHistory).toBeVisible();
    await expect(registrationHistory.getByRole("columnheader", { name: "Actor" })).toBeVisible();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`registration-history-${width}.png`), fullPage: true });
    }
    await page.reload();
    await expect(page.getByRole("tab", { name: "Audit log", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(registrationHistory).toBeVisible();

    await page.goto(`/portal/#/users/${record!.user_id}`);
    await page.getByRole("button", { name: "Actions for Personal", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit identity profile…", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Edit profile:/ })).toBeVisible();
    await expect(page.locator('[name="jobTitle"]')).toHaveCount(0);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`personal-editor-${width}.png`), fullPage: true });
    }
    await page.goto(`/portal/#/users/${record!.user_id}`);
    const organizationName = `Identity-only organization ${crypto.randomUUID()}`;
    const organizationResponse = await page.request.post("/api/v1/organizations", {
      data: organizationCreateSchema.parse({ name: organizationName }),
    });
    expect(organizationResponse.status()).toBe(201);
    const organization = organizationCreateResponseSchema.parse(await organizationResponse.json()).organization;
    const original = userDetailResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${record!.user_id}`)).json(),
    ).user;
    await page.getByRole("button", { name: "Add identity", exact: true }).click();
    const addIdentity = page.getByRole("dialog", { name: "Add identity", exact: true });
    await expect(addIdentity.getByLabel("Category", { exact: true })).toHaveCount(0);
    await addIdentity.getByRole("combobox", { name: /^Organization(?:\s*\(required\))?$/ }).fill(organizationName);
    await page.getByRole("option").filter({ hasText: organizationName }).click();
    await addIdentity.getByRole("textbox", { name: /^Job title(?:\s*\(required\))?$/ }).fill("Researcher");
    await addIdentity.getByRole("checkbox", { name: /^Activate immediately/ }).check();
    await addIdentity
      .getByRole("textbox", { name: /^Activation reason(?:\s*\(required\))?$/ })
      .fill("An omitted organization identity was reviewed.");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`add-identity-${width}.png`) });
    }
    const identityCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/organizations/${organization.id}/identities`,
    );
    await addIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
    const identityResponse = await identityCreated;
    expect(identityResponse.status()).toBe(201);
    const identity = identityMutationResponseSchema.parse(await identityResponse.json());
    await expect(addIdentity).not.toBeVisible();
    const after = userDetailResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${record!.user_id}`)).json(),
    ).user;
    expect(after.identities.find((entry) => entry.identityId === identity.identityId)?.memberId).toBeNull();
    expect(after.identities.flatMap((entry) => (entry.memberId ? [entry.memberId] : []))).toEqual(
      original.identities.flatMap((entry) => (entry.memberId ? [entry.memberId] : [])),
    );
    await signInToPortal(attendee, email);
    const beforeCorrection = registrationManageReadResponseSchema.parse(
      await (await attendee.request.get(`/api/v1/registrations/${record!.id}`)).json(),
    );
    const linked = await attendee.request.put(`/api/v1/registrations/${record!.id}/identity`, {
      data: registrationIdentityChangeSchema.parse({
        identityId: identity.identityId,
        expectedIdentityId: beforeCorrection.identityId ?? null,
      }),
    });
    expect(linked.status()).toBe(200);
    await page.getByRole("button", { name: `Actions for ${organizationName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete identity…", exact: true }).click();
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === `/api/v1/users/${record!.user_id}/identities/${identity.identityId}`,
    );
    const deletionConfirmation = page.getByRole("alertdialog", { name: "Delete identity?", exact: true });
    await deletionConfirmation.getByRole("button", { name: "Delete identity", exact: true }).click();
    expect((await deleted).status()).toBe(409);
    const correction = page.getByRole("dialog", { name: "Correct identity", exact: true });
    await expect(correction).toBeVisible();
    await correction.getByRole("combobox", { name: /^Representation/ }).click();
    await page
      .getByRole("option")
      .filter({ hasText: /^Personal(?: ·|$)/ })
      .click();
    await correction
      .getByRole("textbox", { name: /^Reason for correction/ })
      .fill("The organization was linked incorrectly.");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`correct-to-personal-${width}.png`) });
    }
    const corrected = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(`/identities/${identity.identityId}/corrections`),
    );
    await correction.getByRole("button", { name: "Correct identity", exact: true }).click();
    expect((await corrected).status()).toBe(200);
    await expect(correction).not.toBeVisible();
    await expect(page.getByRole("button", { name: `Actions for ${organizationName}`, exact: true })).toHaveCount(0);
    const registrationAfter = registrationManageReadResponseSchema.parse(
      await (await attendee.request.get(`/api/v1/registrations/${record!.id}`)).json(),
    );
    expect(registrationAfter.identityId).toBe(
      original.identities.find((entry) => entry.organizationId === null)!.identityId,
    );
    expect(registrationAfter.registration.id).toBe(record!.id);
    const personalId = registrationAfter.identityId!;
    const replacementName = `Staff-approved organization ${crypto.randomUUID()}`;
    const replacementResponse = await page.request.post("/api/v1/organizations", {
      data: organizationCreateSchema.parse({ name: replacementName }),
    });
    expect(replacementResponse.status()).toBe(201);
    const replacementOrganization = organizationCreateResponseSchema.parse(
      await replacementResponse.json(),
    ).organization;
    await page.getByRole("button", { name: "Actions for Personal", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete identity…", exact: true }).click();
    const personalConfirmation = page.getByRole("alertdialog", { name: "Delete identity?", exact: true });
    await personalConfirmation.getByRole("button", { name: "Delete identity", exact: true }).click();
    const personalCorrection = page.getByRole("dialog", { name: "Correct identity", exact: true });
    await expect(personalCorrection).toBeVisible();
    await personalCorrection.getByRole("button", { name: "Add identity", exact: true }).click();
    await expect(addIdentity).toBeVisible();
    await addIdentity.getByRole("combobox", { name: /^Organization/ }).fill(replacementName);
    await page.getByRole("option").filter({ hasText: replacementName }).click();
    await addIdentity.getByRole("textbox", { name: /^Job title/ }).fill("Research lead");
    await expect(addIdentity.getByRole("checkbox", { name: /^Activate immediately/ })).toBeChecked();
    await expect(addIdentity.getByRole("alert")).toContainText("even if their email domain differs");
    await addIdentity
      .getByRole("textbox", { name: /^Activation reason/ })
      .fill("The association was independently verified despite the different email domain.");
    const replacementCreated = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/organizations/${replacementOrganization.id}/identities`,
    );
    await addIdentity.getByRole("button", { name: "Add identity", exact: true }).click();
    const replacementResult = await replacementCreated;
    expect(replacementResult.status()).toBe(201);
    const replacement = identityMutationResponseSchema.parse(await replacementResult.json());
    await expect(addIdentity).not.toBeVisible();
    await expect(personalCorrection.getByRole("combobox", { name: /^Representation/ })).toContainText(replacementName);
    await personalCorrection
      .getByRole("textbox", { name: /^Reason for correction/ })
      .fill("Participation belongs to the verified organization identity.");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: info.outputPath(`correct-personal-to-organization-${width}.png`) });
    }
    const personalCorrected = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(`/identities/${personalId}/corrections`),
    );
    await personalCorrection.getByRole("button", { name: "Correct identity", exact: true }).click();
    expect((await personalCorrected).status()).toBe(200);
    await expect(personalCorrection).not.toBeVisible();
    const finalRegistration = registrationManageReadResponseSchema.parse(
      await (await attendee.request.get(`/api/v1/registrations/${record!.id}`)).json(),
    );
    expect(finalRegistration.identityId).toBe(replacement.identityId);
    const preservedAccount = userAuthSessionResponseSchema.parse(
      await (await attendee.request.get("/api/v1/auth/session")).json(),
    );
    expect(preservedAccount.identity.id).toBe(record!.user_id);
    expect(preservedAccount.actingIdentities.some((entry) => entry.id === personalId)).toBe(false);

    await expect(page.getByRole("table", { name: "Audit log", exact: true })).toHaveCount(0);
    const auditLoaded = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/users/${record!.user_id}/audit-log`),
    );
    await page.getByRole("tab", { name: "Audit log", exact: true }).click();
    expect((await auditLoaded).status()).toBe(200);
    const accountHistory = page.getByRole("tabpanel", { name: "Audit log", exact: true });
    await expect(accountHistory.getByRole("table", { name: "Audit log", exact: true })).toBeVisible();
    await expect(accountHistory.getByText("user updated", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Audit example/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/users/${record!.user_id}/audit-log$`));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Audit log", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(accountHistory.getByText("user updated", { exact: true })).toBeVisible();
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`account-audit-log-${width}.png`), fullPage: true });
    }
  } finally {
    await context.close();
  }
});
