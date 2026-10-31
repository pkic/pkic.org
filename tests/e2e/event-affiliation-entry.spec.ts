import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
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
  // Email-first: a work address takes part on behalf of its organization unless the person says otherwise.
  await page.getByLabel(EMAIL_FIRST_COPY.proposal.work.label, { exact: true }).fill(email);
  const since = await capturedEmailCount();
  const sent = responseFor(page, `${endpoint}/proof`);
  await page.getByRole("button", { name: EMAIL_FIRST_COPY.proposal.work.action, exact: true }).click();
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
  // The link carries the terms agreed before it was sent: it is read at once, and they are not asked again.
  const verified = responseFor(page, `${endpoint}/proof/verify`);
  await page.goto(mailUrl);
  const response = await verified;
  await expect(page.locator('[data-step="2"]')).toBeVisible();
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
  // A new account starts with its individual identity and no organization one.
  expect(originalUser.identities).toEqual([
    expect.objectContaining({ organizationId: null, organizationName: null, memberId: null }),
  ]);
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
    const newEmail = `person@nonmember-${suffix}.test`;
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    await guest.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(newEmail) });
    await guest.goto(pagePath);
    const identity = guest.locator("[data-proposer-identity]");
    // The terms come first; the contact step then asks which email, with the work email chosen and its field alone.
    await expect(guest.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(identity.getByRole("textbox")).toHaveCount(0);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    await expect(identity.getByRole("radio")).toHaveCount(2);
    await expect(
      identity.getByRole("radio", { name: EMAIL_FIRST_COPY.proposal.work.title, exact: true }),
    ).toBeChecked();
    await expect(identity.getByRole("textbox")).toHaveCount(1);
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
      ["Job title", "Conference engineer"],
    ]) {
      const control = identity.getByLabel(fieldLabel(label));
      await expect(control).toHaveCount(1);
      await control.fill(value);
    }
    await guest.getByRole("button", { name: "Clear unsaved changes", exact: true }).click();
    for (const label of ["First name", "Last name", "Organization name", "Job title"])
      await expect(identity.getByLabel(fieldLabel(label))).toHaveValue("");
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    for (const [label, value] of [
      ["First name", "New"],
      ["Last name", "Participant"],
      ["Organization name", organizationName],
      ["Job title", "Conference engineer"],
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
    // The new account holds its individual identity beside the organization one the proof created.
    expect(createdUser.identities).toHaveLength(2);
    expect(createdUser.identities.find((entry) => entry.organizationId === null)).toMatchObject({
      organizationName: null,
      memberId: null,
    });
    const affiliation = createdUser.identities.find((entry) => entry.organizationId !== null)!;
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
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    const reused = await openProposalProof(guest, await requestOrganizationProof(guest, newEmail));
    expect(reused.person).toMatchObject({ firstName: "New", lastName: "Participant" });
    await expect(guest.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    const beforeNames = await readUser(staff, createdUser.id);
    await expect(identity.getByText("New Participant", { exact: true })).toBeVisible();
    await guest.getByRole("button", { name: "Edit my details", exact: true }).click();
    // Editing opens a dialog on the page, outside the identity step it was opened from.
    const detailsDialog = guest.getByRole("dialog", { name: "Edit my details", exact: true });
    await detailsDialog.getByRole("textbox", { name: /^First name/ }).fill("Renamed");
    await detailsDialog.getByRole("textbox", { name: /^Last name/ }).fill("Participant");
    const savedNames = responseFor(guest, `${endpoint}/proof/person`, "PATCH");
    await detailsDialog.getByRole("button", { name: "Save my details", exact: true }).click();
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
    await expect(detailsDialog).toHaveCount(0);
    const renamed = await readUser(staff, createdUser.id);
    expect(renamed).toMatchObject({ id: createdUser.id, first_name: "Renamed", last_name: "Participant" });
    expect(renamed.identities).toEqual(beforeNames.identities);
    await capture(guest, info, "known-person-names-saved");
    // The picker loads its catalog as soon as it opens, before anything is chosen.
    const listed = responseFor(guest, `${endpoint}/proof/identities`);
    await guest.getByRole("button", { name: "Choose another representation", exact: true }).click();
    const picker = guest.getByRole("combobox", { name: "Representation", exact: true });
    await picker.click();
    const listResponse = await listed;
    expect(listResponse.status(), await listResponse.text()).toBe(200);
    expect(eventProposalProofIdentitiesSchema.parse(listResponse.request().postDataJSON()).continuationToken).toBe(
      reused.continuationToken,
    );
    const catalog = identitiesListResponseSchema.parse(await listResponse.json());
    expect(catalog.identities).toHaveLength(1);
    expect(catalog.identities[0]).toMatchObject({ id: affiliation.identityId, userId: createdUser.id, memberId: null });
    await guest
      .getByRole("listbox", { name: "Your identities" })
      .getByRole("option")
      .filter({ hasText: organizationName })
      .click();
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    expect((await readUser(staff, createdUser.id)).first_name).toBe("Renamed");
    expect((await readUser(staff, createdUser.id)).identities).toEqual(renamed.identities);
    for (const label of ["First name", "Last name", "Organization name", "Job title"])
      await expect(identity.getByRole("textbox", { name: fieldLabel(label) })).toHaveCount(0);

    const alternateEmail = `alternate@nonmember-${suffix}.test`;
    await guest.getByRole("button", { name: "Add representation", exact: true }).click();
    const alternateMail = await requestOrganizationProof(guest, alternateEmail, undefined, reused.continuationToken);
    expect((await usersByEmail(staff, alternateEmail)).page.total).toBe(0);
    expect(await readUser(staff, createdUser.id)).toEqual(renamed);
    const alternateProof = await openProposalProof(guest, alternateMail);
    expect(alternateProof.person).toMatchObject({ firstName: "Renamed", lastName: "Participant" });
    // The representation already held carries its job title: the person is not asked for it again.
    expect(alternateProof.organization).toEqual({
      id: affiliation.organizationId,
      name: organizationName,
      jobTitle: "Conference engineer",
    });
    await expect(identity.getByLabel(fieldLabel("Job title"))).toHaveCount(0);
    await expect(identity.getByRole("textbox", { name: fieldLabel("Organization name") })).toHaveCount(0);
    // The organization is chosen in the proof's own organization list, with the role it already holds.
    await expect(identity.getByRole("combobox", { name: /^Organization/ })).toHaveValue(affiliation.organizationId!);
    await expect(identity.getByText("Conference engineer", { exact: true })).toBeVisible();
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
    await picker.click();
    await guest
      .getByRole("listbox", { name: "Your identities" })
      .getByRole("option")
      .filter({ hasText: "Conference engineer" })
      .click();
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    await expect(identity.getByText("Conference engineer", { exact: true })).toBeVisible();
    expect(await readUser(staff, createdUser.id)).toEqual(parallelUser);
    await capture(guest, info, "canonical-representation-reused");
    const parallelEmail = `person@parallel-${suffix}.test`;
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
    await identity.getByLabel(fieldLabel("Job title")).fill("Parallel role");
    await submitOwnProofProposal(guest, `Parallel representation ${suffix}`, additionalProof.continuationToken);
    const twoRepresentations = await readUser(staff, createdUser.id);
    expect((await usersByEmail(staff, parallelEmail)).users[0]!.id).toBe(createdUser.id);
    expect(twoRepresentations.identities).toHaveLength(3);
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
      await picker.click();
      await guest
        .getByRole("listbox", { name: "Your identities" })
        .getByRole("option")
        .filter({ hasText: organization })
        .filter({ hasText: role })
        .click();
      await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
      await expect(identity.getByText(role, { exact: true })).toBeVisible();
      expect(await readUser(staff, createdUser.id)).toEqual(twoRepresentations);
    }
    await capture(guest, info, "parallel-representation-selected");

    const invitation = await waitForCapturedEmail(knownEmail, "Speaker invitation: please confirm", { since });
    const speakerUrl = extractEmailUrl(invitation, "/speaker/");
    const oldToken = new URL(speakerUrl).searchParams.get("token")!;
    await guest.goto(speakerUrl);
    const invited = await readSpeaker(guest, oldToken);
    expect(invited.speaker).toMatchObject({ userId: knownId, status: "invited" });
    const beforeMailboxProof = await readUser(staff, knownId);
    await expect(guest.getByRole("radio")).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Confirm participation", exact: true })).toBeDisabled();
    await acceptVisibleTerms(guest, "[data-speaker-consents]");
    const secondaryEmail = `person@secondary-${suffix}.test`;
    const secondaryMail = await requestOrganizationProof(guest, secondaryEmail, oldToken);
    expect(await readUser(staff, knownId)).toEqual(beforeMailboxProof);
    expect((await readSpeaker(guest, oldToken)).profile).toEqual(invited.profile);

    // The delivered link alone resumes the exact invitation in a fresh browser.
    const resumed = await resumeContext.newPage();
    await resumed.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(secondaryEmail) });
    // The one confirmation of the link hands the speaker page its own token; the page does not verify again.
    const redirected = responseFor(resumed, `${endpoint}/proof/verify`);
    await resumed.goto(secondaryMail);
    const redirectResponse = await redirected;
    expect(redirectResponse.status()).toBe(200);
    expect(
      eventProposalProofVerifySchema.parse(redirectResponse.request().postDataJSON()).speakerManagementToken,
    ).toBeUndefined();
    await expect(resumed.getByRole("button", { name: "Save speaker identity", exact: true })).toBeVisible();
    for (const term of await resumed.locator("[data-speaker-consents]").getByRole("checkbox").all())
      await expect(term).toBeChecked();
    const verifiedBody = eventProposalProofVerifyResponseSchema.parse(await redirectResponse.json());
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
    await speakerIdentity.getByLabel(fieldLabel("Job title")).fill("Program contributor");
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
    await resumed.getByRole("button", { name: "Save speaker identity", exact: true }).click();
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
    expect(afterUser.identities).toHaveLength(2);
    expect(afterUser.identities).toContainEqual(originalUser.identities[0]);
    const proved = afterUser.identities.find((entry) => entry.organizationId !== null);
    expect(proved).toMatchObject({
      identityId: recorded.profile.actingIdentityId,
      email: secondaryEmail,
      organizationName: secondaryOrganization,
      memberId: null,
      membershipCategory: null,
    });
    expect(proved!.emailId).not.toBeNull();
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
    await expect(resumed.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    expect((await readSpeaker(resumed, returnedToken)).speaker.status).toBe("confirmed");
    expect((await originalProposal()).speakers.find((speaker) => speaker.userId === knownId)).toEqual(
      originalAppearance,
    );
    await capture(resumed, info, "invited-secondary-saved-summary");
    const currentIdentityId = recorded.profile.actingIdentityId!;
    const organizationId = proved!.organizationId!;
    const organizationResponse = await staff.request.get(`/api/v1/organizations/${organizationId}`);
    expect(organizationResponse.status(), await organizationResponse.text()).toBe(200);
    const organizationBefore = organizationDetailResponseSchema.parse(await organizationResponse.json()).organization;
    // The role is edited on the identity itself, through the speaker link: it changes that identity only.
    const identityProfile = resumed.locator("[data-identity-profile]");
    for (const label of ["First name", "Last name", "Organization name", "Email"])
      await expect(resumed.getByRole("textbox", { name: label, exact: true })).toHaveCount(0);
    await identityProfile.getByLabel(fieldLabel("Job title for this organization")).fill("Updated contributor");
    const roleSaved = responseFor(resumed, `${endpoint}/proof/identities/${currentIdentityId}`, "PATCH");
    await identityProfile.getByRole("button", { name: "Save changes", exact: true }).click();
    const roleResponse = await roleSaved;
    expect(roleResponse.status(), await roleResponse.text()).toBe(200);
    expect(eventProposalProofIdentityPatchSchema.parse(roleResponse.request().postDataJSON())).toMatchObject({
      jobTitle: "Updated contributor",
      speakerManagementToken: returnedToken,
    });
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await roleResponse.json())).toMatchObject({
      identityId: currentIdentityId,
      organizationId,
      jobTitle: "Updated contributor",
    });
    const afterRole = await readUser(staff, knownId);
    expect(afterRole.identities).toEqual(
      afterUser.identities.map((entry) =>
        entry.identityId === currentIdentityId
          ? // The profile form submits its biography field as written, so an unset biography reads back empty.
            { ...entry, jobTitle: "Updated contributor", biography: entry.biography ?? "" }
          : entry,
      ),
    );
    expect({ ...afterRole, identities: [] }).toEqual({ ...afterUser, identities: [] });
    const organizationAfterResponse = await staff.request.get(`/api/v1/organizations/${organizationId}`);
    expect(organizationAfterResponse.status()).toBe(200);
    const organizationAfter = organizationDetailResponseSchema.parse(
      await organizationAfterResponse.json(),
    ).organization;
    expect({ ...organizationAfter, identities: [] }).toEqual({ ...organizationBefore, identities: [] });
    // The speaker appears as the live identity they act as, so only its new title changes.
    expect((await readSpeaker(resumed, returnedToken)).profile).toEqual({
      ...recorded.profile,
      jobTitle: "Updated contributor",
      biography: recorded.profile.biography ?? "",
    });
    expect((await originalProposal()).speakers.find((speaker) => speaker.userId === knownId)).toEqual(
      originalAppearance,
    );
    await capture(resumed, info, "current-representation-role-saved");
  } finally {
    await guestContext.close();
    await resumeContext.close();
  }
});
