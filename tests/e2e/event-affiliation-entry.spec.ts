import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  eventProposalProofIdentityPatchSchema,
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofPersonPatchSchema,
  eventProposalProofPersonPatchResponseSchema,
  eventProposalProofIdentitiesSchema,
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import { organizationDetailResponseSchema } from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import {
  proposalAccessReadResponseSchema,
  proposalCreateSchema,
  proposalCreateResponseSchema,
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
} from "../../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { userDetailResponseSchema, usersListResponseSchema } from "../../assets/shared/schemas/user-management";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { clientIpForIdentity, signInToPortal } from "./helpers/portal-auth";
import { acceptVisibleTerms, answerRequiredProposalFields, fieldLabel } from "./helpers/proposal-entry-ui";
import { PROPOSAL_EVENT_SLUG, submitProposal } from "./helpers/proposals";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

const pagePath = `/events/2026/${PROPOSAL_EVENT_SLUG}/propose/`;
const endpoint = `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals`;
const abstract =
  "A purpose-created conference proposal about verified organizational relationships, preserving known personal details, and keeping event representation distinct from membership.";
const biography =
  "A synthetic speaker whose canonical personal information is reused through verified conference participation.";

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === method,
  );
}

async function capture(page: Page, info: TestInfo, phase: string) {
  await page.getByRole("heading", { level: 1 }).click();
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const alignment = await page.locator(".event-flow").evaluate((flow) => {
      const outer = flow.closest(".pk-container")!;
      const outerStyle = getComputedStyle(outer);
      const box = flow.getBoundingClientRect();
      const content = flow.querySelector("[data-speaker-content]")?.getBoundingClientRect();
      return {
        inset: box.left - outer.getBoundingClientRect().left - parseFloat(outerStyle.paddingLeft),
        innerPadding: parseFloat(getComputedStyle(flow).paddingLeft),
        contentWidth: content ? box.width - content.width : 0,
      };
    });
    expect(Math.abs(alignment.inset)).toBeLessThanOrEqual(1);
    expect(alignment.innerPadding).toBe(0);
    expect(Math.abs(alignment.contentWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`${phase}-${device}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function requestOrganizationProof(page: Page, email: string, speakerToken?: string, continuationToken?: string) {
  await page
    .getByRole("radio", { name: "On behalf of an organization (my employer or my own company)", exact: true })
    .check();
  await page.getByLabel("Work email address", { exact: true }).fill(email);
  const since = await capturedEmailCount();
  const sent = responseFor(page, `${endpoint}/proof`);
  await page.getByRole("button", { name: "Verify work email", exact: true }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  const started = eventProposalProofStartSchema.parse(response.request().postDataJSON());
  expect(started).toMatchObject({
    email,
    unaffiliatedAttestation: false,
  });
  expect(started.speakerManagementToken).toBe(speakerToken);
  expect(started.continuationToken).toBe(continuationToken);
  expect(eventProposalProofStartResponseSchema.parse(await response.json()).status).toBe("verification_sent");
  return extractEmailUrl(await waitForCapturedEmail(email, "Verify your email for", { since }), "/propose/");
}

async function openProposalProof(page: Page, mailUrl: string) {
  const verified = responseFor(page, `${endpoint}/proof/verify`);
  await page.goto(mailUrl);
  const terms = page.locator("[data-consents]").getByRole("checkbox").first();
  const contact = page.locator('[data-step="2"]');
  await expect.poll(async () => (await terms.isVisible()) || (await contact.isVisible())).toBe(true);
  if (await terms.isVisible()) {
    await acceptVisibleTerms(page, "[data-consents]");
    await page.getByRole("button", { name: "Continue →", exact: true }).click();
  } else {
    await expect(contact).toBeVisible();
    await expect(page.getByRole("button", { name: "Return to step 1", exact: true })).toBeVisible();
  }
  const response = await verified;
  expect(response.status(), await response.text()).toBe(200);
  eventProposalProofVerifySchema.parse(response.request().postDataJSON());
  const result = eventProposalProofVerifyResponseSchema.parse(await response.json());
  if (result.status !== "ready") throw new Error("The actual mailbox proof must be ready");
  return result;
}

async function submitOwnProofProposal(page: Page, title: string, continuationToken: string) {
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.getByRole("radio", { name: "Talk", exact: true }).check();
  await page.getByLabel(fieldLabel("Title")).fill(title);
  await page.getByRole("textbox", { name: "Abstract", exact: true }).fill(abstract);
  await answerRequiredProposalFields(page);
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
  await page.getByLabel("I will also be presenting — add me as one of the speakers", { exact: true }).check();
  await page
    .getByRole("region", { name: "You — as a speaker", exact: true })
    .getByRole("textbox", { name: "Bio", exact: true })
    .fill(biography);
  const submitted = responseFor(page, endpoint);
  await page.getByRole("button", { name: "Submit proposal →", exact: true }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(200);
  expect(proposalCreateSchema.parse(response.request().postDataJSON()).continuationToken).toBe(continuationToken);
  proposalCreateResponseSchema.parse(await response.json());
}

async function readUser(staff: Page, id: string) {
  const response = await staff.request.get(`/api/v1/users/${encodeURIComponent(id)}`);
  expect(response.status(), await response.text()).toBe(200);
  return userDetailResponseSchema.parse(await response.json()).user;
}

async function usersByEmail(staff: Page, email: string) {
  const response = await staff.request.get(`/api/v1/users?q=${encodeURIComponent(email)}&limit=1`);
  expect(response.status(), await response.text()).toBe(200);
  return usersListResponseSchema.parse(await response.json());
}

async function readSpeaker(page: Page, token: string) {
  const response = await page.request.get(`/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`);
  expect(response.status(), await response.text()).toBe(200);
  return speakerSelfServiceReadResponseSchema.parse(await response.json());
}

test("guest event entry creates a nonmember affiliation and an invited known person proves a different work mailbox", async ({
  page: staff,
  browser,
}, info) => {
  test.setTimeout(300_000);
  await signInToPortal(staff, e2eAdminEmail("portal-proposal-states"));
  const suffix = randomUUID();
  const knownEmail = `known-invitee-${suffix}@gmail.com`;
  const knownFixture = await submitProposal(staff, {
    proposerEmail: knownEmail,
    firstName: "Known",
    lastName: "Invitee",
    title: `Known individual fixture ${suffix}`,
    abstract,
  });
  const knownPeople = await usersByEmail(staff, knownEmail);
  expect(knownPeople.page.total).toBe(1);
  const knownId = knownPeople.users[0]!.id;
  const originalUser = await readUser(staff, knownId);
  expect(originalUser.identities).toEqual([]);
  const originalProposal = async () => {
    const response = await staff.request.get(
      `/api/v1/proposals/access/${encodeURIComponent(knownFixture.accessToken)}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    return proposalAccessReadResponseSchema.parse(await response.json());
  };
  const beforeProposal = await originalProposal();
  const originalAppearance = beforeProposal.speakers.find((speaker) => speaker.userId === knownId);
  expect(originalAppearance?.actingIdentitySelection).toBe("individual");
  const guestContext = await browser.newContext({ baseURL: new URL(staff.url()).origin });
  const resumeContext = await browser.newContext({ baseURL: new URL(staff.url()).origin });
  try {
    const guest = await guestContext.newPage();
    const newEmail = `person@nonmember-${suffix}.example.test`;
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    await guest.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(newEmail) });
    await guest.goto(pagePath);
    const identity = guest.locator("[data-proposer-identity]");
    await expect(guest.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(identity.getByRole("radio")).toHaveCount(0);
    await expect(identity.getByRole("textbox")).toHaveCount(0);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    const mailUrl = await requestOrganizationProof(guest, newEmail);
    await expect(identity.getByLabel(fieldLabel("First name"))).toHaveCount(0);
    const proof = await openProposalProof(guest, mailUrl);
    expect(proof).toMatchObject({ email: newEmail, applicantKind: "organization", person: null, organization: null });
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    const organizationName = `Nonmember affiliation ${suffix}`;
    for (const [label, value] of [
      ["First name", "New"],
      ["Last name", "Participant"],
      ["Organization name", organizationName],
      ["Job title (optional)", "Conference engineer"],
    ]) {
      const control = identity.getByLabel(fieldLabel(label));
      await expect(control).toHaveCount(1);
      await control.fill(value);
    }
    await guest.getByRole("button", { name: "Clear unsaved changes", exact: true }).click();
    for (const label of ["First name", "Last name", "Organization name", "Job title (optional)"])
      await expect(identity.getByLabel(fieldLabel(label))).toHaveValue("");
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    for (const [label, value] of [
      ["First name", "New"],
      ["Last name", "Participant"],
      ["Organization name", organizationName],
      ["Job title (optional)", "Conference engineer"],
    ])
      await identity.getByLabel(fieldLabel(label)).fill(value);
    await expect(identity.locator(".pk-datalist")).not.toContainText("New Participant");
    await expect(identity.locator(".pk-datalist")).not.toContainText(organizationName);
    await expect(identity.getByRole("combobox")).toHaveCount(0);
    await capture(guest, info, "new-nonmember-details");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    await guest.getByRole("radio", { name: "Talk", exact: true }).check();
    await guest.getByLabel(fieldLabel("Title")).fill(`New nonmember affiliation ${suffix}`);
    await guest.getByRole("textbox", { name: "Abstract", exact: true }).fill(abstract);
    await answerRequiredProposalFields(guest);
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    await guest.getByLabel("I will also be presenting — add me as one of the speakers", { exact: true }).check();
    const ownCard = guest.getByRole("region", { name: "You — as a speaker", exact: true });
    await expect(ownCard.getByText("New Participant", { exact: true })).toBeVisible();
    await expect(ownCard.getByText(organizationName, { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Email", "Organization (optional)", "Job title (optional)"])
      await expect(ownCard.getByRole("textbox", { name: label, exact: true })).toHaveCount(0);
    await ownCard.getByRole("textbox", { name: "Bio", exact: true }).fill(biography);
    const catalogs: string[] = [];
    guest.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/identities")) catalogs.push(request.url());
    });
    await guest.getByRole("button", { name: "Add speaker", exact: true }).click();
    const otherCard = guest.getByRole("region", { name: "Speaker 1", exact: true });
    await otherCard.getByLabel("First name", { exact: true }).fill("Known");
    await otherCard.getByLabel("Last name", { exact: true }).fill("Invitee");
    await otherCard.getByLabel("Email", { exact: true }).fill(knownEmail);
    await otherCard.getByRole("textbox", { name: "Bio", exact: true }).fill(biography);
    await expect(otherCard.getByRole("combobox")).toHaveCount(0);
    expect(catalogs).toEqual([]);
    const since = await capturedEmailCount();
    const submitted = responseFor(guest, endpoint);
    await guest.getByRole("button", { name: "Submit proposal →", exact: true }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(200);
    const input = proposalCreateSchema.parse(response.request().postDataJSON());
    expect(input.proposer).toMatchObject({ firstName: "New", lastName: "Participant", organizationName });
    expect(input.proposer.actingIdentityId).toBeUndefined();
    expect(input.continuationToken).toBe(proof.continuationToken);
    expect(input.unaffiliatedAttestation).toBe(false);
    proposalCreateResponseSchema.parse(await response.json());
    const newPeople = await usersByEmail(staff, newEmail);
    expect(newPeople.page.total).toBe(1);
    const createdUser = await readUser(staff, newPeople.users[0]!.id);
    expect(createdUser.identities).toHaveLength(1);
    const affiliation = createdUser.identities[0]!;
    expect(affiliation).toMatchObject({
      email: newEmail,
      organizationName,
      jobTitle: "Conference engineer",
      memberId: null,
      membershipCategory: null,
      status: null,
    });
    expect(affiliation.organizationId).not.toBeNull();

    // Repeat mailbox proof to reuse the new link through the actual owned catalog.
    await guest.goto(pagePath);
    await expect(guest.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    const reused = await openProposalProof(guest, await requestOrganizationProof(guest, newEmail));
    expect(reused.person).toMatchObject({ firstName: "New", lastName: "Participant" });
    await expect(guest.getByRole("combobox", { name: "Your organization representation", exact: true })).toHaveCount(0);
    const beforeNames = await readUser(staff, createdUser.id);
    await expect(identity.getByText("New Participant", { exact: true })).toBeVisible();
    await guest.getByRole("button", { name: "Edit my details", exact: true }).click();
    await identity.getByRole("textbox", { name: "First name", exact: true }).fill("Renamed");
    await identity.getByRole("textbox", { name: "Last name", exact: true }).fill("Participant");
    const savedNames = responseFor(guest, `${endpoint}/proof/person`, "PATCH");
    await guest.getByRole("button", { name: "Save my details", exact: true }).click();
    const namesResponse = await savedNames;
    expect(namesResponse.status(), await namesResponse.text()).toBe(200);
    expect(eventProposalProofPersonPatchSchema.parse(namesResponse.request().postDataJSON())).toMatchObject({
      firstName: "Renamed",
      lastName: "Participant",
      continuationToken: reused.continuationToken,
    });
    expect(eventProposalProofPersonPatchResponseSchema.parse(await namesResponse.json()).person).toMatchObject({
      firstName: "Renamed",
      lastName: "Participant",
    });
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    await expect(identity.getByRole("textbox", { name: "First name", exact: true })).toHaveCount(0);
    const renamed = await readUser(staff, createdUser.id);
    expect(renamed).toMatchObject({ id: createdUser.id, first_name: "Renamed", last_name: "Participant" });
    expect(renamed.identities).toEqual(beforeNames.identities);
    await capture(guest, info, "known-person-names-saved");
    await guest.getByRole("button", { name: "Choose another representation", exact: true }).click();
    const picker = guest.getByRole("combobox", { name: "Your organization representation", exact: true });
    const listed = responseFor(guest, `${endpoint}/proof/identities`);
    await picker.fill(organizationName);
    const listResponse = await listed;
    expect(listResponse.status(), await listResponse.text()).toBe(200);
    expect(eventProposalProofIdentitiesSchema.parse(listResponse.request().postDataJSON()).continuationToken).toBe(
      reused.continuationToken,
    );
    const catalog = identitiesListResponseSchema.parse(await listResponse.json());
    expect(catalog.identities).toHaveLength(1);
    expect(catalog.identities[0]).toMatchObject({ id: affiliation.identityId, userId: createdUser.id, memberId: null });
    await guest.getByRole("option").filter({ hasText: organizationName }).click();
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    expect((await readUser(staff, createdUser.id)).first_name).toBe("Renamed");
    expect((await readUser(staff, createdUser.id)).identities).toEqual(renamed.identities);
    for (const label of ["First name", "Last name", "Organization name", "Job title (optional)"])
      await expect(identity.getByRole("textbox", { name: fieldLabel(label) })).toHaveCount(0);

    const alternateEmail = `alternate@nonmember-${suffix}.example.test`;
    await guest.getByRole("button", { name: "Add representation", exact: true }).click();
    const alternateMail = await requestOrganizationProof(guest, alternateEmail, undefined, reused.continuationToken);
    expect((await usersByEmail(staff, alternateEmail)).page.total).toBe(0);
    expect(await readUser(staff, createdUser.id)).toEqual(renamed);
    const alternateProof = await openProposalProof(guest, alternateMail);
    expect(alternateProof.person).toMatchObject({ firstName: "Renamed", lastName: "Participant" });
    expect(alternateProof.organization).toEqual({ id: affiliation.organizationId, name: organizationName });
    await expect(identity.getByLabel(fieldLabel("Job title (optional)"))).toHaveCount(0);
    await expect(identity.getByRole("textbox", { name: fieldLabel("Organization name") })).toHaveCount(0);
    await expect(identity.getByText(organizationName, { exact: true })).toBeVisible();
    await submitOwnProofProposal(guest, `Verified alternate mailbox ${suffix}`, alternateProof.continuationToken);
    const aliasPeople = await usersByEmail(staff, alternateEmail);
    expect(aliasPeople.page.total).toBe(1);
    expect(aliasPeople.users[0]!.id).toBe(createdUser.id);
    const parallelUser = await readUser(staff, createdUser.id);
    expect(parallelUser).toMatchObject({ email: renamed.email, first_name: "Renamed", last_name: "Participant" });
    expect(parallelUser.identities).toEqual(renamed.identities);
    expect(parallelUser.identities.find((entry) => entry.identityId === affiliation.identityId)).toEqual(affiliation);
    await guest.goto(pagePath);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    const parallelProof = await openProposalProof(guest, await requestOrganizationProof(guest, alternateEmail));
    expect(parallelProof.person).toMatchObject({ firstName: "Renamed", lastName: "Participant" });
    await guest.getByRole("button", { name: "Choose another representation", exact: true }).click();
    await picker.fill(organizationName);
    await guest.getByRole("option").filter({ hasText: "Conference engineer" }).click();
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    await expect(identity.getByText("Conference engineer", { exact: true })).toBeVisible();
    expect(await readUser(staff, createdUser.id)).toEqual(parallelUser);
    await capture(guest, info, "canonical-representation-reused");
    const parallelEmail = `person@parallel-${suffix}.example.test`;
    await guest.getByRole("button", { name: "Add representation", exact: true }).click();
    const parallelMail = await requestOrganizationProof(
      guest,
      parallelEmail,
      undefined,
      parallelProof.continuationToken,
    );
    const additionalProof = await openProposalProof(guest, parallelMail);
    expect(additionalProof.person).toMatchObject({ firstName: "Renamed", lastName: "Participant" });
    expect(additionalProof.organization).toBeNull();
    const parallelOrganization = `Parallel organization ${suffix}`;
    await identity.getByLabel(fieldLabel("Organization name")).fill(parallelOrganization);
    await identity.getByLabel(fieldLabel("Job title (optional)")).fill("Parallel role");
    await submitOwnProofProposal(guest, `Parallel representation ${suffix}`, additionalProof.continuationToken);
    const twoRepresentations = await readUser(staff, createdUser.id);
    expect((await usersByEmail(staff, parallelEmail)).users[0]!.id).toBe(createdUser.id);
    expect(twoRepresentations.identities).toHaveLength(2);
    expect(twoRepresentations.identities.find((entry) => entry.identityId === affiliation.identityId)).toEqual(
      affiliation,
    );
    expect(twoRepresentations.identities.find((entry) => entry.email === parallelEmail)).toMatchObject({
      organizationName: parallelOrganization,
      jobTitle: "Parallel role",
      memberId: null,
    });
    await guest.goto(pagePath);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    await openProposalProof(guest, await requestOrganizationProof(guest, parallelEmail));
    for (const [organization, role] of [
      [organizationName, "Conference engineer"],
      [parallelOrganization, "Parallel role"],
    ]) {
      await guest.getByRole("button", { name: "Choose another representation", exact: true }).click();
      await picker.fill(organization);
      await guest.getByRole("option").filter({ hasText: role }).click();
      await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
      await expect(identity.getByText(role, { exact: true })).toBeVisible();
      expect(await readUser(staff, createdUser.id)).toEqual(twoRepresentations);
    }
    await capture(guest, info, "parallel-representation-selected");

    const invitation = await waitForCapturedEmail(knownEmail, "You have been added as a speaker", { since });
    const speakerUrl = extractEmailUrl(invitation, "/speaker/");
    const oldToken = new URL(speakerUrl).searchParams.get("token")!;
    await guest.goto(speakerUrl);
    const invited = await readSpeaker(guest, oldToken);
    expect(invited.speaker).toMatchObject({ userId: knownId, status: "invited" });
    const beforeMailboxProof = await readUser(staff, knownId);
    await expect(guest.getByRole("radio")).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Confirm participation", exact: true })).toBeDisabled();
    await acceptVisibleTerms(guest, "[data-speaker-consents]");
    const secondaryEmail = `person@secondary-${suffix}.example.test`;
    const secondaryMail = await requestOrganizationProof(guest, secondaryEmail, oldToken);
    expect(await readUser(staff, knownId)).toEqual(beforeMailboxProof);
    expect((await readSpeaker(guest, oldToken)).profile).toEqual(invited.profile);

    // The delivered link alone resumes the exact invitation in a fresh browser.
    const resumed = await resumeContext.newPage();
    await resumed.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(secondaryEmail) });
    await resumed.goto(secondaryMail);
    await expect(resumed.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    const redirected = responseFor(resumed, `${endpoint}/proof/verify`);
    await acceptVisibleTerms(resumed, "[data-consents]");
    await resumed.getByRole("button", { name: "Continue →", exact: true }).click();
    const redirectResponse = await redirected;
    expect(redirectResponse.status()).toBe(200);
    expect(
      eventProposalProofVerifySchema.parse(redirectResponse.request().postDataJSON()).speakerManagementToken,
    ).toBeUndefined();
    await expect(resumed.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
    const verified = responseFor(resumed, `${endpoint}/proof/verify`);
    await acceptVisibleTerms(resumed, "[data-speaker-consents]");
    const verifyResponse = await verified;
    expect(verifyResponse.status(), await verifyResponse.text()).toBe(200);
    const verifiedBody = eventProposalProofVerifyResponseSchema.parse(await verifyResponse.json());
    if (verifiedBody.status !== "ready") throw new Error("The invited person's secondary mailbox must be verified");
    expect(verifiedBody).toMatchObject({
      email: secondaryEmail,
      applicantKind: "organization",
      person: { firstName: "Known", lastName: "Invitee" },
    });
    const returnedToken = new URL(resumed.url()).searchParams.get("token")!;
    expect((await readSpeaker(resumed, returnedToken)).speaker.userId).toBe(knownId);
    const speakerIdentity = resumed.locator("[data-speaker-identity]");
    await expect(speakerIdentity.getByText("Known Invitee", { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Email"])
      await expect(speakerIdentity.getByRole("textbox", { name: fieldLabel(label) })).toHaveCount(0);
    const secondaryOrganization = `Secondary work affiliation ${suffix}`;
    await speakerIdentity.getByLabel(fieldLabel("Organization name")).fill(secondaryOrganization);
    await speakerIdentity.getByLabel(fieldLabel("Job title (optional)")).fill("Program contributor");
    const knownSummaries = speakerIdentity.locator(".pk-datalist");
    await expect(knownSummaries).toHaveCount(2);
    await expect(knownSummaries.nth(0)).toContainText("Known Invitee");
    await expect(knownSummaries.nth(1)).toContainText(secondaryEmail);
    for (const summary of [knownSummaries.nth(0), knownSummaries.nth(1)]) {
      await expect(summary).not.toContainText(secondaryOrganization);
      await expect(summary).not.toContainText("Program contributor");
    }
    expect(await readUser(staff, knownId)).toEqual(beforeMailboxProof);
    expect((await readSpeaker(resumed, returnedToken)).profile).toEqual(invited.profile);
    await expect(speakerIdentity.getByRole("combobox")).toHaveCount(0);
    await capture(resumed, info, "invited-secondary-known-details");
    const profilePath = `/api/v1/proposals/speakers/access/${encodeURIComponent(returnedToken)}/profile`;
    const saved = responseFor(resumed, profilePath, "PATCH");
    await resumed.getByRole("button", { name: "Save profile", exact: true }).click();
    const saveResponse = await saved;
    expect(saveResponse.status(), await saveResponse.text()).toBe(200);
    const profileInput = speakerSelfProfilePatchSchema.parse(saveResponse.request().postDataJSON());
    expect(profileInput).toMatchObject({
      continuationToken: verifiedBody.continuationToken,
      unaffiliatedAttestation: false,
      organizationName: secondaryOrganization,
      jobTitle: "Program contributor",
    });
    expect(profileInput.firstName).toBeUndefined();
    expect(profileInput.lastName).toBeUndefined();
    const recorded = await readSpeaker(resumed, returnedToken);
    expect(recorded.speaker.userId).toBe(knownId);
    expect(recorded.profile).toMatchObject({
      organizationName: secondaryOrganization,
      jobTitle: "Program contributor",
      actingIdentitySelection: "identity",
    });
    const afterUser = await readUser(staff, knownId);
    expect(afterUser).toMatchObject({
      id: originalUser.id,
      email: originalUser.email,
      first_name: originalUser.first_name,
      last_name: originalUser.last_name,
    });
    expect(afterUser.identities).toHaveLength(1);
    expect(afterUser.identities[0]).toMatchObject({
      identityId: recorded.profile.actingIdentityId,
      email: secondaryEmail,
      organizationName: secondaryOrganization,
      memberId: null,
      membershipCategory: null,
    });
    expect(afterUser.identities[0]!.emailId).not.toBeNull();
    expect((await resumed.request.get("/api/v1/auth/session")).status()).toBe(401);
    const confirmed = responseFor(
      resumed,
      `/api/v1/proposals/speakers/access/${encodeURIComponent(returnedToken)}/participation`,
      "PATCH",
    );
    await resumed.getByRole("button", { name: "Confirm participation", exact: true }).click();
    const confirmResponse = await confirmed;
    expect(confirmResponse.status()).toBe(200);
    expect(speakerParticipationPatchSchema.parse(confirmResponse.request().postDataJSON()).status).toBe("confirmed");
    await expect(resumed.getByText("You have confirmed your participation. Thank you!", { exact: true })).toBeVisible();
    await resumed.reload();
    await expect(resumed.getByText("You have confirmed your participation. Thank you!", { exact: true })).toBeVisible();
    await expect(
      resumed.locator("[data-speaker-identity]").getByText(secondaryOrganization, { exact: true }),
    ).toBeVisible();
    await expect(resumed.getByRole("combobox", { name: "Your organization representation", exact: true })).toHaveCount(
      0,
    );
    expect((await readSpeaker(resumed, returnedToken)).speaker.status).toBe("confirmed");
    expect((await originalProposal()).speakers.find((speaker) => speaker.userId === knownId)).toEqual(
      originalAppearance,
    );
    await capture(resumed, info, "invited-secondary-saved-summary");
    const currentIdentityId = recorded.profile.actingIdentityId!;
    const organizationId = afterUser.identities[0]!.organizationId!;
    const organizationResponse = await staff.request.get(`/api/v1/organizations/${organizationId}`);
    expect(organizationResponse.status(), await organizationResponse.text()).toBe(200);
    const organizationBefore = organizationDetailResponseSchema.parse(await organizationResponse.json()).organization;
    await resumed.getByRole("button", { name: "Update current representation", exact: true }).click();
    for (const label of ["First name", "Last name", "Organization name", "Email"])
      await expect(resumed.getByRole("textbox", { name: label, exact: true })).toHaveCount(0);
    await resumed.getByLabel(fieldLabel("Job title (optional)")).fill("Updated contributor");
    const roleSaved = responseFor(resumed, `${endpoint}/proof/identities/${currentIdentityId}`, "PATCH");
    await resumed.getByRole("button", { name: "Save representation", exact: true }).click();
    const roleResponse = await roleSaved;
    expect(roleResponse.status(), await roleResponse.text()).toBe(200);
    expect(eventProposalProofIdentityPatchSchema.parse(roleResponse.request().postDataJSON())).toEqual({
      jobTitle: "Updated contributor",
      speakerManagementToken: returnedToken,
    });
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await roleResponse.json())).toEqual({
      identityId: currentIdentityId,
      jobTitle: "Updated contributor",
    });
    const afterRole = await readUser(staff, knownId);
    expect(afterRole.identities).toEqual(
      afterUser.identities.map((entry) =>
        entry.identityId === currentIdentityId ? { ...entry, jobTitle: "Updated contributor" } : entry,
      ),
    );
    expect({ ...afterRole, identities: [] }).toEqual({ ...afterUser, identities: [] });
    const organizationAfterResponse = await staff.request.get(`/api/v1/organizations/${organizationId}`);
    expect(organizationAfterResponse.status()).toBe(200);
    const organizationAfter = organizationDetailResponseSchema.parse(
      await organizationAfterResponse.json(),
    ).organization;
    expect({ ...organizationAfter, identities: [] }).toEqual({ ...organizationBefore, identities: [] });
    expect((await readSpeaker(resumed, returnedToken)).profile).toEqual(recorded.profile);
    expect((await originalProposal()).speakers.find((speaker) => speaker.userId === knownId)).toEqual(
      originalAppearance,
    );
    await capture(resumed, info, "current-representation-role-saved");
  } finally {
    await guestContext.close();
    await resumeContext.close();
  }
});
