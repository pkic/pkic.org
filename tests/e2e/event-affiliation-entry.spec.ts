import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { randomUUID } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  eventProposalProofPersonPatchSchema,
  eventProposalProofPersonPatchResponseSchema,
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
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
import { signInToPortal } from "./helpers/portal-auth";
import { acceptVisibleTerms, answerRequiredProposalFields, fieldLabel } from "./helpers/proposal-entry-ui";
import { PROPOSAL_EVENT_SLUG, submitProposal } from "./helpers/proposals";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { signInThroughCard } from "./helpers/sign-in-card";

const pagePath = `/events/2026/${PROPOSAL_EVENT_SLUG}/propose/`;
const endpoint = `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals`;
const abstract =
  "A purpose-created conference proposal about verified organizational relationships, preserving known personal details, and keeping event representation distinct from membership.";
const biography =
  "A synthetic speaker whose canonical personal information is reused through verified conference participation.";

function responseFor(page: Page, path: string, method = "POST") {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === method,
    { timeout: 30_000 },
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

/** A speaker's own mailbox proof, started from the speaker step's email-first entry. */
async function requestSpeakerOrganizationProof(page: Page, email: string, linkPath: string) {
  // Email-first: a work address takes part on behalf of its organization unless the person says otherwise.
  await page.getByLabel(EMAIL_FIRST_COPY.speaker.work.label, { exact: true }).fill(email);
  const since = await capturedEmailCount();
  const sent = responseFor(page, `${endpoint}/proof`);
  await page.getByRole("button", { name: EMAIL_FIRST_COPY.speaker.work.action, exact: true }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(200);
  expect(eventProposalProofStartSchema.parse(response.request().postDataJSON())).toMatchObject({
    email,
    unaffiliatedAttestation: false,
  });
  expect(eventProposalProofStartResponseSchema.parse(await response.json()).status).toBe("verification_sent");
  return extractEmailUrl(await waitForCapturedEmail(email, "Verify your email for", { since }), linkPath);
}

/** The proposal form opens on its terms; the contact step follows them. */
async function openContactStep(page: Page) {
  await page.goto(pagePath);
  await acceptVisibleTerms(page, "[data-consents]");
  await page.getByRole("button", { name: "Continue →", exact: true }).click();
}

/**
 * Adds a representation from the signed-in contact step. An address the
 * account has not proved yet is verified from its own email first; the
 * organization is then named, or already decided by what the person holds.
 */
async function addRepresentation(
  page: Page,
  email: string,
  details: { organizationName?: string; jobTitle?: string; verify: boolean },
) {
  const dialog = page.getByRole("dialog", { name: "Add identity", exact: true });
  await dialog.getByLabel(EMAIL_FIRST_COPY.representation.work.label, { exact: true }).fill(email);
  const since = await capturedEmailCount();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  if (details.verify) {
    await expect(dialog).toContainText("Open the verification email");
    const message = await waitForCapturedEmail(email, "Verify your email", { since });
    const verification = await page.context().newPage();
    await verification.goto(extractEmailUrl(message, "/email-verifications"));
    await verification.getByRole("button", { name: "Verify this address", exact: true }).click();
    await expect(verification.getByText(`${email} is verified`, { exact: true })).toBeVisible();
    await verification.close();
    await dialog.getByRole("button", { name: "Check verification", exact: true }).click();
  }
  const add = dialog.getByRole("button", { name: "Add representation", exact: true });
  await expect(add).toBeVisible();
  if (details.organizationName)
    await dialog.getByRole("textbox", { name: /^Organization name/ }).fill(details.organizationName);
  if (details.jobTitle) await dialog.getByRole("textbox", { name: /^Job title/ }).fill(details.jobTitle);
  return { dialog, add };
}

async function submitOwnProposal(page: Page, title: string, actingIdentityId: string) {
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
  const input = proposalCreateSchema.parse(response.request().postDataJSON());
  expect(input.proposer.actingIdentityId).toBe(actingIdentityId);
  expect(input.unaffiliatedAttestation).toBe(false);
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

async function readSpeaker(page: Page, proposalId: string) {
  const response = await page.request.get(`/api/v1/proposals/${encodeURIComponent(proposalId)}/participation`);
  expect(response.status(), await response.text()).toBe(200);
  return speakerSelfServiceReadResponseSchema.parse(await response.json());
}

test("a new proposer signs in, adds a nonmember affiliation, and an invited known person proves a different work mailbox", async ({
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
    guest.setDefaultTimeout(20_000);
    const newEmail = `person@nonmember-${suffix}.test`;
    expect((await usersByEmail(staff, newEmail)).page.total).toBe(0);
    await guest.goto(pagePath);
    const identity = guest.locator("[data-proposer-identity]");
    // The terms come first; signed out, the contact step is the shared sign-in card and asks nothing itself.
    await expect(guest.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(identity.getByRole("textbox")).toHaveCount(0);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    await expect(identity.getByRole("region", { name: "Sign in", exact: true })).toBeVisible();
    await expect(identity.getByRole("radio")).toHaveCount(0);
    await expect(identity.getByRole("textbox")).toHaveCount(0);
    await signInThroughCard(guest, newEmail, { emailFlow: "proposal" });
    // Opening the link creates the account with its individual identity alone: no organization is assumed.
    const newPeople = await usersByEmail(staff, newEmail);
    expect(newPeople.page.total).toBe(1);
    const createdId = newPeople.users[0]!.id;
    expect((await readUser(staff, createdId)).identities).toEqual([
      expect.objectContaining({ organizationId: null, organizationName: null, memberId: null }),
    ]);
    await acceptVisibleTerms(guest, "[data-consents]");
    await guest.getByRole("button", { name: "Continue →", exact: true }).click();
    const picker = guest.getByRole("combobox", { name: "Representation", exact: true });
    await expect(picker).toBeVisible();
    await expect(guest.getByRole("button", { name: "Continue →", exact: true })).toBeHidden();
    // The work address is the account's own, proved at sign-in: the organization is named without another email.
    const organizationName = `Nonmember affiliation ${suffix}`;
    await identity.getByRole("button", { name: "Add identity", exact: true }).click();
    const first = await addRepresentation(guest, newEmail, {
      organizationName,
      jobTitle: "Conference engineer",
      verify: false,
    });
    await first.add.click();
    await expect(first.dialog).not.toBeVisible();
    const createdUser = await readUser(staff, createdId);
    // The account holds its individual identity beside the organization one just added.
    expect(createdUser.identities).toHaveLength(2);
    expect(createdUser.identities.find((entry) => entry.organizationId === null)).toMatchObject({
      organizationName: null,
      memberId: null,
    });
    let affiliation = createdUser.identities.find((entry) => entry.organizationId !== null)!;
    expect(affiliation).toMatchObject({
      email: newEmail,
      organizationName,
      jobTitle: "Conference engineer",
      memberId: null,
      membershipCategory: null,
      status: null,
    });
    await expect(identity.getByText(organizationName, { exact: true })).toBeVisible();
    // A new account has no name yet: it is asked here and saved with the proposal.
    for (const [label, value] of [
      ["First name", "New"],
      ["Last name", "Participant"],
    ]) {
      const control = identity.getByLabel(fieldLabel(label));
      await expect(control).toHaveCount(1);
      await control.fill(value);
    }
    await guest.getByRole("button", { name: "Clear unsaved changes", exact: true }).click();
    for (const label of ["First name", "Last name"])
      await expect(identity.getByLabel(fieldLabel(label))).toHaveValue("");
    expect(await readUser(staff, createdId)).toMatchObject({ first_name: null, last_name: null });
    await identity.getByLabel(fieldLabel("First name")).fill("New");
    await identity.getByLabel(fieldLabel("Last name")).fill("Participant");
    await capture(guest, info, "new-nonmember-details");
    for (const label of ["Organization name", "Job title"])
      await expect(identity.getByRole("textbox", { name: fieldLabel(label) })).toHaveCount(0);
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
    expect(input.proposer).toMatchObject({ firstName: "New", lastName: "Participant" });
    expect(input.proposer.actingIdentityId).toBe(affiliation.identityId);
    expect(input.unaffiliatedAttestation).toBe(false);
    const submittedProposal = proposalCreateResponseSchema.parse(await response.json());
    expect(await readUser(staff, createdId)).toMatchObject({ first_name: "New", last_name: "Participant" });
    // The speaker biography belongs to the identity spoken as, so submitting saved it there and nowhere else.
    const submittedUser = await readUser(staff, createdId);
    expect(submittedUser.identities).toEqual(
      createdUser.identities.map((entry) =>
        entry.identityId === affiliation.identityId ? { ...entry, biography } : entry,
      ),
    );
    affiliation = submittedUser.identities.find((entry) => entry.identityId === affiliation.identityId)!;

    // Returning signed in, the saved name and the representation already held are reused.
    await openContactStep(guest);
    await picker.click();
    await guest
      .getByRole("listbox", { name: "Your identities" })
      .getByRole("option")
      .filter({ hasText: organizationName })
      .click();
    const beforeNames = await readUser(staff, createdId);
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
    expect(eventProposalProofPersonPatchSchema.parse(namesResponse.request().postDataJSON())).toEqual({
      firstName: "Renamed",
      lastName: "Participant",
    });
    expect(eventProposalProofPersonPatchResponseSchema.parse(await namesResponse.json()).person).toMatchObject({
      firstName: "Renamed",
      lastName: "Participant",
    });
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    await expect(detailsDialog).toHaveCount(0);
    const renamed = await readUser(staff, createdId);
    expect(renamed).toMatchObject({ id: createdId, first_name: "Renamed", last_name: "Participant" });
    expect(renamed.identities).toEqual(beforeNames.identities);
    await capture(guest, info, "known-person-names-saved");
    // The picker lists the account's own organization identities.
    const listed = responseFor(guest, "/api/v1/users/current/identities", "GET");
    await guest.getByRole("button", { name: "Choose another representation", exact: true }).click();
    await picker.click();
    const listResponse = await listed;
    expect(listResponse.status(), await listResponse.text()).toBe(200);
    const catalog = identitiesListResponseSchema.parse(await listResponse.json());
    expect(catalog.identities).toHaveLength(1);
    expect(catalog.identities[0]).toMatchObject({ id: affiliation.identityId, userId: createdId, memberId: null });
    await guest
      .getByRole("listbox", { name: "Your identities" })
      .getByRole("option")
      .filter({ hasText: organizationName })
      .click();
    await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
    expect((await readUser(staff, createdId)).identities).toEqual(renamed.identities);
    for (const label of ["First name", "Last name", "Organization name", "Job title"])
      await expect(identity.getByRole("textbox", { name: fieldLabel(label) })).toHaveCount(0);
    await capture(guest, info, "canonical-representation-reused");

    // A second work mailbox on another domain is proved from its own email and adds a parallel representation.
    const parallelEmail = `person@parallel-${suffix}.test`;
    const parallelOrganization = `Parallel organization ${suffix}`;
    await guest.getByRole("button", { name: "Add representation", exact: true }).click();
    const parallel = await addRepresentation(guest, parallelEmail, {
      organizationName: parallelOrganization,
      jobTitle: "Parallel role",
      verify: true,
    });
    await parallel.add.click();
    await expect(parallel.dialog).not.toBeVisible();
    expect((await usersByEmail(staff, parallelEmail)).users[0]!.id).toBe(createdId);
    const added = await readUser(staff, createdId);
    expect(added.identities).toHaveLength(3);
    expect(added.identities.find((entry) => entry.identityId === affiliation.identityId)).toEqual(affiliation);
    const parallelIdentity = added.identities.find((entry) => entry.email === parallelEmail)!;
    expect(parallelIdentity).toMatchObject({
      organizationName: parallelOrganization,
      jobTitle: "Parallel role",
      memberId: null,
    });
    await expect(identity.getByText("Parallel role", { exact: true })).toBeVisible();
    await submitOwnProposal(guest, `Parallel representation ${suffix}`, parallelIdentity.identityId);
    const twoRepresentations = await readUser(staff, createdId);
    expect(twoRepresentations.identities).toHaveLength(3);
    expect(twoRepresentations.identities.find((entry) => entry.identityId === affiliation.identityId)).toEqual(
      affiliation,
    );
    await openContactStep(guest);
    for (const [organization, role] of [
      [organizationName, "Conference engineer"],
      [parallelOrganization, "Parallel role"],
    ]) {
      const another = guest.getByRole("button", { name: "Choose another representation", exact: true });
      await expect(picker.or(another).first()).toBeVisible();
      if (!(await picker.isVisible())) await another.click();
      await picker.click();
      await guest
        .getByRole("listbox", { name: "Your identities" })
        .getByRole("option")
        .filter({ hasText: organization })
        .filter({ hasText: role })
        .click();
      await expect(identity.getByText("Renamed Participant", { exact: true })).toBeVisible();
      await expect(identity.getByText(role, { exact: true })).toBeVisible();
      expect(await readUser(staff, createdId)).toEqual(twoRepresentations);
    }
    await capture(guest, info, "parallel-representation-selected");

    const invitation = await waitForCapturedEmail(knownEmail, "Speaker invitation: please confirm", { since });
    const speakerUrl = extractEmailUrl(invitation, "/portal/");
    const proposalId = submittedProposal.proposalId!;
    const resumed = await resumeContext.newPage();
    resumed.setDefaultTimeout(20_000);
    await signInToPortal(resumed, knownEmail);
    await resumed.goto(speakerUrl);
    await expect(resumed.getByRole("heading", { name: "Speaker participation" })).toBeVisible();
    const invited = await readSpeaker(resumed, proposalId);
    expect(invited.speaker).toMatchObject({ userId: knownId, status: "invited" });
    const terms = resumed.locator("[data-term-key] input[type='checkbox']");
    await expect(terms.first()).toBeVisible();
    for (let i = 0; i < (await terms.count()); i++) await terms.nth(i).check();
    await resumed.getByRole("button", { name: "I'm presenting as an individual" }).click();
    await completeIndependentCapacityDisclosure(resumed);
    await resumed.getByRole("button", { name: "Save speaker identity", exact: true }).click();
    await expect(resumed.getByText("Speaker identity saved.")).toBeVisible();
    const beforeMailboxProof = await readUser(staff, knownId);
    const beforeAffiliation = await readSpeaker(resumed, proposalId);
    await resumed.getByRole("button", { name: "Add representation", exact: true }).click();
    const secondaryEmail = `person@secondary-${suffix}.test`;
    const secondaryMail = await requestSpeakerOrganizationProof(resumed, secondaryEmail, "/portal/");
    expect(await readUser(staff, knownId)).toEqual(beforeMailboxProof);
    expect((await readSpeaker(resumed, proposalId)).profile).toEqual(beforeAffiliation.profile);

    // Mailbox verification resumes the same signed-in speaker and proposal.
    const redirected = responseFor(resumed, `${endpoint}/proof/verify`);
    await resumed.goto(secondaryMail);
    const redirectResponse = await redirected;
    expect(redirectResponse.status()).toBe(200);
    const verifiedBody = eventProposalProofVerifyResponseSchema.parse(await redirectResponse.json());
    if (verifiedBody.status !== "ready") throw new Error("The invited person's secondary mailbox must be verified");
    expect(verifiedBody.email).toBe(secondaryEmail);
    const secondaryOrganization = `Secondary work affiliation ${suffix}`;
    await resumed.getByLabel(fieldLabel("Organization name")).fill(secondaryOrganization);
    await resumed.getByLabel(fieldLabel("Job title")).fill("Program contributor");
    const profilePath = `/api/v1/proposals/${encodeURIComponent(proposalId)}/participation/profile`;
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
    const recorded = await readSpeaker(resumed, proposalId);
    expect(recorded.speaker.userId).toBe(knownId);
    expect(recorded.profile).toMatchObject({
      organizationName: secondaryOrganization,
      jobTitle: "Program contributor",
    });
    const afterUser = await readUser(staff, knownId);
    expect(afterUser).toMatchObject({ id: originalUser.id, email: originalUser.email });
    expect(afterUser.identities).toContainEqual(originalUser.identities[0]);
    expect(afterUser.identities.find((entry) => entry.email === secondaryEmail)).toMatchObject({
      organizationName: secondaryOrganization,
      memberId: null,
    });
    const confirmed = responseFor(
      resumed,
      `/api/v1/proposals/${encodeURIComponent(proposalId)}/participation`,
      "PATCH",
    );
    await resumed.getByRole("button", { name: "Confirm willingness to participate", exact: true }).click();
    const confirmResponse = await confirmed;
    expect(confirmResponse.status()).toBe(200);
    expect(speakerParticipationPatchSchema.parse(confirmResponse.request().postDataJSON()).status).toBe("confirmed");
    await expect(
      resumed.getByText(
        "Your willingness to participate in this proposal is confirmed. Committee acceptance and scheduling are separate decisions.",
      ),
    ).toBeVisible();
    await resumed.reload();
    expect((await readSpeaker(resumed, proposalId)).speaker.status).toBe("confirmed");
    // The original proposal keeps its original individual attribution.
    expect((await originalProposal()).speakers.find((speaker) => speaker.userId === knownId)).toEqual(
      originalAppearance,
    );
  } finally {
    await guestContext.close();
    await resumeContext.close();
  }
});
