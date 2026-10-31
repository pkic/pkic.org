import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { expect, test, type Page, type Response } from "@playwright/test";
import { actingIdentityLabel } from "../../assets/ts/shared/acting-identity-catalog";
import {
  userUpdateSchema,
  userDetailResponseSchema,
  usersListResponseSchema,
} from "../../assets/shared/schemas/user-management";
import {
  eventProposalProofIdentityPatchSchema,
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofIdentitiesSchema,
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import {
  identitiesListResponseSchema,
  identityUpdateSchema,
  type ActingIdentity,
} from "../../assets/shared/schemas/identity";
import {
  authenticatedProposalCreateSchema,
  proposalCreateSchema,
  proposalAccessReadResponseSchema,
  proposalCreateResponseSchema,
  speakerSelfProfilePatchSchema,
  speakerParticipationPatchSchema,
  coSpeakerInviteResponseSchema,
} from "../../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { userEmailAddSchema, userEmailAddResponseSchema } from "../../assets/shared/schemas/user-emails";
import { captureResponsive } from "./helpers/proposal-speaker-identity";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { PROPOSAL_EVENT_SLUG, submitProposal } from "./helpers/proposals";
import { ownEmailAddressesListResponseSchema } from "../../assets/shared/schemas/own-email-addresses";
import { fieldLabel, acceptVisibleTerms, answerRequiredProposalFields } from "./helpers/proposal-entry-ui";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";

const PROPOSE_PAGE = `/events/2026/${PROPOSAL_EVENT_SLUG}/propose/`;
const PROPOSALS = `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals`;
const ABSTRACT =
  "A practical examination of migration decisions and operational evidence, describing how teams verify representation and keep historical attribution stable as people change roles.";
const BIO = "A synthetic conference speaker with experience implementing and reviewing operational migration programs.";

async function chooseOwnedIdentity(
  page: Page,
  identity: Pick<ActingIdentity, "organizationName" | "jobTitle" | "email">,
): Promise<void> {
  const picker = page.getByRole("combobox", { name: "Representation", exact: true });
  if (!(await picker.isVisible()))
    await page.getByRole("button", { name: "Choose another representation", exact: true }).click();
  await picker.click();
  const option = page.getByRole("option").filter({
    hasText: actingIdentityLabel({ organizationName: identity.organizationName, jobTitle: identity.jobTitle }),
  });
  await expect(option).toHaveCount(1);
  await expect(option).toBeVisible();
  await option.click();
}

test("terms-first proposals and invited speakers verify identity without duplicate personal fields", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  await signInToPortal(page, e2eAdminEmail("proposal-speaker-identity"));
  const own = await createMember(page);
  const guest = await createMember(page);
  const origin = new URL(page.url()).origin;
  const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  const guestPage = await guestContext.newPage();
  try {
    const preparedPerson = await page.request.patch(`/api/v1/users/${own.userId}`, {
      data: userUpdateSchema.parse({ firstName: "Identity", lastName: "Owner" }),
    });
    expect(preparedPerson.status(), await preparedPerson.text()).toBe(200);
    const guestPerson = await page.request.patch(`/api/v1/users/${guest.userId}`, {
      data: userUpdateSchema.parse({ firstName: "Guest", lastName: "Speaker" }),
    });
    expect(guestPerson.status(), await guestPerson.text()).toBe(200);
    const guestDetail = userDetailResponseSchema.parse(
      await (await page.request.get(`/api/v1/users/${guest.userId}`)).json(),
    );
    const originalGuestIdentity = guestDetail.user.identities.find(
      (identity) => identity.identityId === guest.identityId,
    )!;
    const secondaryEmail = `speaker-secondary@${guest.email.split("@")[1]}`;
    const addedEmail = await page.request.post(`/api/v1/users/${guest.userId}/emails`, {
      data: userEmailAddSchema.parse({ email: secondaryEmail }),
    });
    expect(addedEmail.status()).toBe(201);
    const secondary = userEmailAddResponseSchema.parse(await addedEmail.json()).email;
    const guestAffiliation = await page.request.patch(
      `/api/v1/organizations/${originalGuestIdentity.organizationId}/identities/${guest.identityId}`,
      {
        data: identityUpdateSchema.parse({ profile: { jobTitle: "Guest fixture role" } }),
      },
    );
    expect(guestAffiliation.status(), await guestAffiliation.text()).toBe(200);
    const guestIdentity = userDetailResponseSchema
      .parse(await (await page.request.get(`/api/v1/users/${guest.userId}`)).json())
      .user.identities.find((identity) => identity.identityId === guest.identityId)!;
    await signInToPortal(ownerPage, own.email);
    const ownCatalogResponse = await ownerPage.request.get("/api/v1/users/current/identities?active=true");
    expect(ownCatalogResponse.status(), await ownCatalogResponse.text()).toBe(200);
    const initialIdentity = identitiesListResponseSchema
      .parse(await ownCatalogResponse.json())
      .identities.find((identity) => identity.id === own.identityId)!;
    const preparedIdentity = await page.request.patch(
      `/api/v1/organizations/${initialIdentity.organizationId}/identities/${own.identityId}`,
      { data: identityUpdateSchema.parse({ profile: { jobTitle: "Fixture organization role" } }) },
    );
    expect(preparedIdentity.status(), await preparedIdentity.text()).toBe(200);
    const ownIdentity = identitiesListResponseSchema
      .parse(await (await ownerPage.request.get("/api/v1/users/current/identities?active=true")).json())
      .identities.find((identity) => identity.id === own.identityId)!;
    expect(ownIdentity.userId).toBe(own.userId);
    const sinceOwn = await capturedEmailCount();
    const catalogRequests: string[] = [];
    ownerPage.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/identities")) catalogRequests.push(request.url());
    });
    await ownerPage.goto(PROPOSE_PAGE);
    // The terms come first and resolve nobody; the contact step then offers the representations the
    // signed-in person holds, with no capacity question.
    await expect(ownerPage.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    expect(catalogRequests).toEqual([]);
    await captureResponsive(ownerPage, testInfo, "proposal-terms-first");
    await acceptVisibleTerms(ownerPage, "[data-consents]");
    await ownerPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await expect(ownerPage.locator('input[name="applicantKind"]')).toHaveCount(0);
    await expect(ownerPage.getByRole("combobox", { name: "Representation", exact: true })).toBeVisible();
    await captureResponsive(ownerPage, testInfo, "proposal-contact-step");
    await chooseOwnedIdentity(ownerPage, ownIdentity);
    const ownSummary = ownerPage.locator("[data-proposer-identity]").locator("dl");
    await expect(ownSummary.getByText("Identity Owner", { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(own.email, { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(ownIdentity.organizationName!, { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(ownIdentity.jobTitle!, { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Organization name", "Job title"])
      await expect(
        ownerPage.locator("[data-proposer-identity]").getByRole("textbox", { name: fieldLabel(label) }),
      ).toHaveCount(0);
    await captureResponsive(ownerPage, testInfo, "own-proposal-identity");
    await ownerPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await ownerPage.getByRole("radio", { name: "Talk", exact: true }).check();
    await ownerPage.getByLabel(fieldLabel("Title")).fill(`Explicit speaker identity ${own.userId}`);
    await ownerPage.getByRole("textbox", { name: "Abstract", exact: true }).fill(ABSTRACT);
    await answerRequiredProposalFields(ownerPage);
    await ownerPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await ownerPage.getByLabel("I will also be presenting — add me as one of the speakers", { exact: true }).check();
    const ownCard = ownerPage.getByRole("region", { name: "You — as a speaker", exact: true });
    await ownCard.getByRole("textbox", { name: "Bio", exact: true }).fill(BIO);
    await expect(ownCard.getByText("Identity Owner", { exact: true })).toBeVisible();
    await expect(ownCard.getByText(ownIdentity.organizationName!, { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Email", "Organization (optional)", "Job title (optional)"])
      await expect(ownCard.getByRole("textbox", { name: label, exact: true })).toHaveCount(0);
    await ownerPage.getByRole("button", { name: "Add speaker", exact: true }).click();
    const otherCard = ownerPage.getByRole("region", { name: "Speaker 1", exact: true });
    const beforeTypedGuest = catalogRequests.length;
    await otherCard.getByLabel("First name", { exact: true }).fill("Guest");
    await otherCard.getByLabel("Last name", { exact: true }).fill("Speaker");
    await otherCard.getByLabel("Email", { exact: true }).fill(guest.email);
    await expect(otherCard.getByRole("combobox")).toHaveCount(0);
    expect(catalogRequests).toHaveLength(beforeTypedGuest);
    const submitted = ownerPage.waitForResponse(
      (response) => new URL(response.url()).pathname === PROPOSALS && response.request().method() === "POST",
    );
    await ownerPage.getByRole("button", { name: "Submit proposal →", exact: true }).click();
    const submittedResponse = await submitted;
    expect(submittedResponse.status(), await submittedResponse.text()).toBe(200);
    const submittedBody = authenticatedProposalCreateSchema.parse(submittedResponse.request().postDataJSON());
    expect(submittedBody.proposer.actingIdentityId).toBe(own.identityId);
    expect(submittedBody.proposer.firstName).toBeUndefined();
    expect(submittedBody.proposer.lastName).toBeUndefined();
    expect(submittedBody.proposer.email).toBeUndefined();
    expect("actingIdentityId" in submittedBody.speakers[0]).toBe(false);
    const created = proposalCreateResponseSchema.parse(await submittedResponse.json());
    const guestInvitation = await waitForCapturedEmail(guest.email, "Speaker invitation: please confirm", {
      since: sinceOwn,
    });
    const guestSpeakerUrl = extractEmailUrl(guestInvitation, "/speaker/");
    const ownMail = await waitForCapturedEmail(own.email, "proposal", { since: sinceOwn });
    const manageUrl = extractEmailUrl(ownMail, "/propose/manage/");
    const ownSpeakerUrl = extractEmailUrl(ownMail, "/speaker/");
    const speakerToken = new URL(ownSpeakerUrl).searchParams.get("token")!;
    const ownSpeakerPath = `/api/v1/proposals/speakers/access/${encodeURIComponent(speakerToken)}`;
    const beforeSourceEdit = speakerSelfServiceReadResponseSchema.parse(
      await (await ownerPage.request.get(ownSpeakerPath)).json(),
    );
    expect(beforeSourceEdit.profile.actingIdentityId).toBe(own.identityId);
    expect(beforeSourceEdit.profile.organizationName).toBe(ownIdentity.organizationName);
    const rosterCatalogStart = catalogRequests.length;
    await ownerPage.goto(manageUrl);
    await expect(ownerPage.getByLabel(fieldLabel("Title"))).toHaveValue(submittedBody.proposal.title);
    await expect(ownerPage.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    expect(catalogRequests).toHaveLength(rosterCatalogStart);
    const proposerToken = new URL(manageUrl).searchParams.get("token")!;
    const forbiddenCatalog = await ownerPage.request.get(
      `/api/v1/proposals/access/${encodeURIComponent(proposerToken)}/identities`,
    );
    expect([403, 404]).toContain(forbiddenCatalog.status());
    const roster = proposalAccessReadResponseSchema.parse(
      await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
    );
    expect(roster.proposal.id).toBe(created.proposalId);
    // An added speaker is attached to the representation their invited address links to.
    expect(roster.speakers.find((speaker) => speaker.userId === guest.userId)).toMatchObject({
      actingIdentitySelection: "identity",
      actingIdentityId: guest.identityId,
    });
    const sourceEdit = await page.request.patch(
      `/api/v1/organizations/${ownIdentity.organizationId}/identities/${own.identityId}`,
      {
        data: identityUpdateSchema.parse({ profile: { jobTitle: "New role after proposal submission" } }),
      },
    );
    expect(sourceEdit.status(), await sourceEdit.text()).toBe(200);
    const afterSourceEdit = speakerSelfServiceReadResponseSchema.parse(
      await (await ownerPage.request.get(ownSpeakerPath)).json(),
    );
    // The speaker appears as the live identity they act as, so its new title shows without a new selection.
    expect(afterSourceEdit.profile.jobTitle).toBe("New role after proposal submission");
    expect(afterSourceEdit.profile.organizationName).toBe(beforeSourceEdit.profile.organizationName);
    expect(afterSourceEdit.profile.actingIdentitySelectedAt).toBe(beforeSourceEdit.profile.actingIdentitySelectedAt);

    // A fresh individual accepts the terms, takes the email step's individual escape and verifies the mailbox.
    const anonymousEmail = `proposal-individual-${crypto.randomUUID()}@gmail.com`;
    const initialProposalRequests: string[] = [];
    guestPage.on("request", (request) => {
      if (new URL(request.url()).pathname === PROPOSALS && request.method() === "POST")
        initialProposalRequests.push(request.url());
    });
    const userCount = async () => {
      const response = await page.request.get(`/api/v1/users?q=${encodeURIComponent(anonymousEmail)}&limit=1`);
      expect(response.status(), await response.text()).toBe(200);
      return usersListResponseSchema.parse(await response.json()).page.total;
    };
    expect(await userCount()).toBe(0);
    await guestPage.goto(PROPOSE_PAGE);
    const proposerIdentity = guestPage.locator("[data-proposer-identity]");
    await expect(guestPage.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(proposerIdentity.getByRole("textbox")).toHaveCount(0);
    await acceptVisibleTerms(guestPage, "[data-consents]");
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    // The email step is the gate: the wizard offers no way past it until the person is confirmed.
    await expect(guestPage.getByRole("button", { name: "Continue →", exact: true })).toBeHidden();
    await expect(proposerIdentity.getByLabel(EMAIL_FIRST_COPY.proposal.work.label, { exact: true })).toBeVisible();
    await proposerIdentity.getByRole("radio", { name: EMAIL_FIRST_COPY.proposal.personal.title, exact: true }).check();
    await proposerIdentity.getByLabel(EMAIL_FIRST_COPY.proposal.personal.label, { exact: true }).fill(anonymousEmail);
    const proofSince = await capturedEmailCount();
    const proofStart = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === `${PROPOSALS}/proof` && response.request().method() === "POST",
    );
    await proposerIdentity
      .getByRole("button", { name: EMAIL_FIRST_COPY.proposal.personal.action, exact: true })
      .click();
    const started = await proofStart;
    expect(started.status()).toBe(200);
    expect(eventProposalProofStartSchema.parse(started.request().postDataJSON()).unaffiliatedAttestation).toBe(true);
    expect(eventProposalProofStartResponseSchema.parse(await started.json()).status).toBe("verification_sent");
    expect(initialProposalRequests).toEqual([]);
    expect(await userCount()).toBe(0);
    const proofMail = await waitForCapturedEmail(anonymousEmail, "Verify your email for", { since: proofSince });
    const proofVerify = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST",
    );
    // The terms were agreed before the email was sent: the link continues on the contact step.
    await guestPage.goto(extractEmailUrl(proofMail, "/propose/"));
    const verified = await proofVerify;
    expect(verified.status()).toBe(200);
    eventProposalProofVerifySchema.parse(verified.request().postDataJSON());
    const verifiedPerson = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (verifiedPerson.status !== "ready") throw new Error("The browser must verify its mailbox before continuing.");
    expect(verifiedPerson.email).toBe(anonymousEmail);
    expect(verifiedPerson.applicantKind).toBe("individual");
    expect(initialProposalRequests).toEqual([]);
    expect(await userCount()).toBe(0);
    await guestPage.getByLabel(fieldLabel("First name")).fill("Independent");
    await guestPage.getByLabel(fieldLabel("Last name")).fill("Fixture");
    await expect(
      guestPage.locator("[data-proposer-identity]").getByText("Individual participation", { exact: true }),
    ).toBeVisible();
    await completeIndependentCapacityDisclosure(guestPage.locator("[data-proposer-identity]"));
    await captureResponsive(guestPage, testInfo, "verified-anonymous-proposal");
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await guestPage.getByRole("radio", { name: "Talk", exact: true }).check();
    await guestPage.getByLabel(fieldLabel("Title")).fill(`Verified individual proposal ${crypto.randomUUID()}`);
    await guestPage.getByRole("textbox", { name: "Abstract", exact: true }).fill(ABSTRACT);
    await answerRequiredProposalFields(guestPage);
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await guestPage.getByLabel("I will also be presenting — add me as one of the speakers", { exact: true }).check();
    const anonymousCard = guestPage.getByRole("region", { name: "You — as a speaker", exact: true });
    await anonymousCard.getByRole("textbox", { name: "Bio", exact: true }).fill(BIO);
    await expect(anonymousCard.getByText("Independent Fixture", { exact: true })).toBeVisible();
    await expect(anonymousCard.getByRole("textbox", { name: "First name", exact: true })).toHaveCount(0);
    const anonymousSubmitted = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === PROPOSALS && response.request().method() === "POST",
    );
    await guestPage.getByRole("button", { name: "Submit proposal →", exact: true }).click();
    const anonymousCreated = await anonymousSubmitted;
    expect(anonymousCreated.status()).toBe(200);
    const anonymousInput = proposalCreateSchema.parse(anonymousCreated.request().postDataJSON());
    expect(anonymousInput.continuationToken).toBe(verifiedPerson.continuationToken);
    expect(anonymousInput.unaffiliatedAttestation).toBe(true);
    expect(anonymousInput.proposer.actingIdentityId).toBeNull();
    expect(anonymousInput.proposer.firstName).toBe("Independent");
    expect(anonymousInput.proposer.lastName).toBe("Fixture");
    expect(initialProposalRequests).toHaveLength(1);
    expect(await userCount()).toBe(1);

    const guestToken = new URL(guestSpeakerUrl).searchParams.get("token")!;
    let guestSpeakerPath = `/api/v1/proposals/speakers/access/${encodeURIComponent(guestToken)}`;
    const guestCatalogRequests: string[] = [];
    guestPage.on("request", (request) => {
      if (new URL(request.url()).pathname === `${guestSpeakerPath}/identities`)
        guestCatalogRequests.push(request.url());
    });
    const readGuest = async () => {
      const response = await guestPage.request.get(guestSpeakerPath);
      expect(response.status(), await response.text()).toBe(200);
      return speakerSelfServiceReadResponseSchema.parse(await response.json());
    };
    await guestPage.goto(guestSpeakerUrl);
    // No capacity question precedes the email step; the individual capacity is an explicit escape.
    const guestQualifier = guestPage.locator('input[name="applicantKind"]');
    await expect(guestPage.getByRole("button", { name: "Save speaker identity", exact: true })).toBeVisible();
    await expect(guestQualifier).toHaveCount(0);
    await expect(guestPage.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    expect(guestCatalogRequests).toEqual([]);
    const invited = await readGuest();
    expect(invited.speaker.userId).toBe(guest.userId);
    expect(invited.speaker.status).toBe("invited");
    // The invitation already acts as the representation the invited address links to.
    expect(invited.profile.actingIdentitySelection).toBe("identity");
    expect(invited.profile.actingIdentityId).toBe(guest.identityId);
    expect((await guestPage.request.get("/api/v1/auth/session")).status()).toBe(401);
    expect((await guestPage.request.get(`${guestSpeakerPath}/identities`)).status()).toBe(401);
    const anonymousSelection = await guestPage.request.patch(`${guestSpeakerPath}/profile`, {
      data: speakerSelfProfilePatchSchema.parse({ actingIdentityId: guest.identityId }),
    });
    expect(anonymousSelection.status()).toBe(401);
    expect((await readGuest()).profile).toEqual(invited.profile);

    // Another logged-in person cannot turn the invitation into a catalog of the speaker's identities.
    const beforeWrongUser = catalogRequests.length;
    await ownerPage.goto(guestSpeakerUrl);
    await expect(ownerPage.getByRole("button", { name: "Save speaker identity", exact: true })).toBeVisible();
    await acceptVisibleTerms(ownerPage, "[data-speaker-consents]");
    await expect(ownerPage.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    expect(catalogRequests).toHaveLength(beforeWrongUser);
    expect((await ownerPage.request.get(`${guestSpeakerPath}/identities`)).status()).toBe(403);
    const wrongUserSelection = await ownerPage.request.patch(`${guestSpeakerPath}/profile`, {
      data: speakerSelfProfilePatchSchema.parse({ actingIdentityId: guest.identityId }),
    });
    expect(wrongUserSelection.status()).toBe(403);
    expect((await readGuest()).profile).toEqual(invited.profile);

    // The invitation holder can verify their official mailbox without establishing a global portal session.
    const confirmation = guestPage.getByRole("button", { name: "Confirm participation", exact: true });
    // The representation the invited address links to is already recorded, so confirming is not held back.
    await expect(confirmation).toBeEnabled();
    await guestPage.getByRole("button", { name: "Add representation", exact: true }).click();
    await acceptVisibleTerms(guestPage, "[data-speaker-consents]");
    await guestPage.getByLabel(EMAIL_FIRST_COPY.speaker.work.label, { exact: true }).fill(secondaryEmail);
    await captureResponsive(guestPage, testInfo, "invited-speaker-work-proof");
    const speakerProofSince = await capturedEmailCount();
    const speakerProofStart = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === `${PROPOSALS}/proof` && response.request().method() === "POST",
    );
    await guestPage.getByRole("button", { name: EMAIL_FIRST_COPY.speaker.work.action, exact: true }).click();
    const speakerStarted = await speakerProofStart;
    expect(speakerStarted.status()).toBe(200);
    const speakerStartInput = eventProposalProofStartSchema.parse(speakerStarted.request().postDataJSON());
    expect(speakerStartInput.email).toBe(secondaryEmail);
    expect(speakerStartInput.unaffiliatedAttestation).toBe(false);
    expect(speakerStartInput.speakerManagementToken).toBe(guestToken);
    const speakerProofMail = await waitForCapturedEmail(secondaryEmail, "Verify your email for", {
      since: speakerProofSince,
    });
    const emailedProofUrl = extractEmailUrl(speakerProofMail, "/propose/");
    const emailedProofToken = new URLSearchParams(new URL(emailedProofUrl).hash.slice(1)).get("verify");
    const resumeProof = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST",
    );
    const speakerProofResponses: Response[] = [];
    guestPage.on("response", (response) => {
      if (new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST")
        speakerProofResponses.push(response);
    });
    await guestPage.goto(emailedProofUrl);
    const resumedProof = await resumeProof;
    expect(resumedProof.status()).toBe(200);
    const resumeInput = eventProposalProofVerifySchema.parse(resumedProof.request().postDataJSON());
    expect(resumeInput.token).toBe(emailedProofToken);
    expect(resumeInput.speakerManagementToken).toBeUndefined();
    // This response immediately navigates; inspect its request and the destination's verified state.
    await expect(guestPage.getByRole("button", { name: "Save speaker identity", exact: true })).toBeVisible();
    await expect(guestQualifier).toHaveCount(0);
    const speakerVerified = speakerProofResponses.at(-1)!;
    for (const term of await guestPage.locator("[data-speaker-consents]").getByRole("checkbox").all())
      await expect(term).toBeChecked();
    expect(speakerVerified.status()).toBe(200);
    const speakerVerifyInput = eventProposalProofVerifySchema.parse(speakerVerified.request().postDataJSON());
    expect(speakerVerifyInput.token).toBe(emailedProofToken);
    // The emailed proof itself carries the scoped speaker authority; the page reuses that verified result.
    expect(speakerVerifyInput.speakerManagementToken).toBeUndefined();
    const verifiedSpeaker = eventProposalProofVerifyResponseSchema.parse(await speakerVerified.json());
    if (verifiedSpeaker.status !== "ready") throw new Error("The invited speaker must verify their own work mailbox.");
    expect(verifiedSpeaker.email).toBe(secondaryEmail);
    expect(verifiedSpeaker.applicantKind).toBe("organization");
    expect(verifiedSpeaker.speakerManagementToken).toBeTruthy();
    const returnedToken = new URL(guestPage.url()).searchParams.get("token");
    expect(returnedToken).toBeTruthy();
    expect(returnedToken).not.toBe(guestToken);
    expect(new URL(verifiedSpeaker.speakerManageUrl!).searchParams.get("token")).toBe(
      verifiedSpeaker.speakerManagementToken,
    );
    const resumedSpeaker = speakerSelfServiceReadResponseSchema.parse(
      await (
        await guestPage.request.get(
          `/api/v1/proposals/speakers/access/${encodeURIComponent(verifiedSpeaker.speakerManagementToken!)}`,
        )
      ).json(),
    );
    expect(resumedSpeaker.proposal.id).toBe(invited.proposal.id);
    expect(resumedSpeaker.profile).toEqual(invited.profile);
    expect(resumedSpeaker.speaker.userId).toBe(guest.userId);
    guestSpeakerPath = `/api/v1/proposals/speakers/access/${encodeURIComponent(returnedToken!)}`;
    const verifiedCatalog = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/identities` && response.request().method() === "POST",
    );
    await chooseOwnedIdentity(guestPage, guestIdentity);
    const catalogResponse = await verifiedCatalog;
    expect(catalogResponse.status()).toBe(200);
    const catalogProof = eventProposalProofIdentitiesSchema.parse(catalogResponse.request().postDataJSON());
    expect(catalogProof.continuationToken).toBe(verifiedSpeaker.continuationToken);
    expect(catalogProof.speakerManagementToken).toBe(returnedToken);
    const catalog = identitiesListResponseSchema.parse(await catalogResponse.json());
    expect(catalog.identities.every((identity) => identity.userId === guest.userId)).toBe(true);
    expect(catalog.identities.some((identity) => identity.id === own.identityId)).toBe(false);
    const selectedIdentity = catalog.identities.find((identity) => identity.id === guest.identityId)!;
    expect(selectedIdentity.email).toBe(guest.email);
    const guestSummary = guestPage.locator("[data-speaker-identity]").locator("dl");
    await expect(guestSummary.getByText("Guest Speaker", { exact: true })).toBeVisible();
    await expect(guestSummary.getByText(selectedIdentity.organizationName!, { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Organization name", "Job title"])
      await expect(
        guestPage.locator("[data-speaker-identity]").getByRole("textbox", { name: fieldLabel(label) }),
      ).toHaveCount(0);
    const save = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${guestSpeakerPath}/profile` && response.request().method() === "PATCH",
    );
    await guestPage.getByRole("button", { name: "Save speaker identity", exact: true }).click();
    const saved = await save;
    expect(saved.status()).toBe(200);
    const savedInput = speakerSelfProfilePatchSchema.parse(saved.request().postDataJSON());
    expect(savedInput.continuationToken).toBe(verifiedSpeaker.continuationToken);
    expect(savedInput.actingIdentityId).toBe(guest.identityId);
    expect(savedInput.unaffiliatedAttestation).toBe(false);
    const recorded = await readGuest();
    expect(recorded.profile.actingIdentitySelection).toBe("identity");
    expect(recorded.profile.organizationName).toBe(selectedIdentity.organizationName);
    const guestBiography = `${BIO} These program details were reviewed through the invitation link.`;
    await guestPage
      .getByRole("textbox", { name: `Your speaker bio at ${selectedIdentity.organizationName}`, exact: true })
      .fill(guestBiography);
    const profileSave = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals/proof/identities/${guest.identityId}` &&
        response.request().method() === "PATCH",
    );
    await guestPage.getByRole("button", { name: "Save changes", exact: true }).click();
    const profileSaved = await profileSave;
    expect(profileSaved.status(), await profileSaved.text()).toBe(200);
    expect(eventProposalProofIdentityPatchSchema.parse(profileSaved.request().postDataJSON()).biography).toBe(
      guestBiography,
    );
    // Final profile commitment verifies the same-person secondary mailbox; select its exact canonical ID.
    const selectedMailbox = await page.request.patch(
      `/api/v1/organizations/${selectedIdentity.organizationId}/identities/${selectedIdentity.id}`,
      { data: identityUpdateSchema.parse({ profile: { emailId: secondary.id } }) },
    );
    expect(selectedMailbox.status()).toBe(200);
    expect((await readGuest()).currentRepresentation?.email).toBe(secondaryEmail);
    await expect(confirmation).toBeEnabled();
    const consentCount = await guestPage.locator("[data-speaker-consents]").getByRole("checkbox").count();
    const participation = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${guestSpeakerPath}/participation` &&
        response.request().method() === "PATCH",
    );
    await confirmation.click();
    const confirmed = await participation;
    expect(confirmed.status()).toBe(200);
    const confirmationInput = speakerParticipationPatchSchema.parse(confirmed.request().postDataJSON());
    expect(confirmationInput.status).toBe("confirmed");
    if (confirmationInput.status === "confirmed") expect(confirmationInput.consents).toHaveLength(consentCount);
    await expect(guestPage.locator("[data-confirmed-msg]")).toBeVisible();
    const reloadedSummary = guestPage.locator("[data-speaker-identity]").locator("dl");
    await expect(reloadedSummary.getByText("Guest Speaker", { exact: true })).toBeVisible();
    await expect(reloadedSummary.getByText(secondaryEmail, { exact: true })).toBeVisible();
    await expect(reloadedSummary.getByText(selectedIdentity.organizationName!, { exact: true })).toBeVisible();
    await expect(guestPage.getByRole("combobox", { name: "Representation", exact: true })).toHaveCount(0);
    expect(guestCatalogRequests).toEqual([]);
    await captureResponsive(guestPage, testInfo, "recorded-invited-speaker");
    const reviewed = await readGuest();
    expect(reviewed.speaker.userId).toBe(guest.userId);
    expect(reviewed.speaker.status).toBe("confirmed");
    expect(reviewed.profile.actingIdentityId).toBe(guest.identityId);
    expect(reviewed.profile.actingIdentitySelectedAt).toBe(recorded.profile.actingIdentitySelectedAt);
    expect(reviewed.profile.biography).toBe(guestBiography);
    expect(reviewed.currentRepresentation?.email).toBe(secondaryEmail);
    expect(reviewed.profile.email).toBe(guest.email);
    const rosterBefore = proposalAccessReadResponseSchema
      .parse(
        await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
      )
      .speakers.find((speaker) => speaker.userId === guest.userId);
    const role = "Updated verified speaker role";
    const rolePath = `${PROPOSALS}/proof/identities/${selectedIdentity.id}`;
    const roleInput = guestPage.getByRole("textbox", {
      name: "Job title for this organization (required)",
      exact: true,
    });
    await roleInput.fill(role);
    const roleSave = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === rolePath && response.request().method() === "PATCH",
    );
    await guestPage.getByRole("button", { name: "Save changes", exact: true }).click();
    const roleResponse = await roleSave;
    expect(roleResponse.status()).toBe(200);
    expect(eventProposalProofIdentityPatchSchema.parse(roleResponse.request().postDataJSON())).toMatchObject({
      jobTitle: role,
      speakerManagementToken: returnedToken,
    });
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await roleResponse.json())).toMatchObject({
      identityId: selectedIdentity.id,
      jobTitle: role,
    });
    await expect(reloadedSummary.getByText(role, { exact: true })).toBeVisible();
    await expect(roleInput).toHaveValue(role);
    await guestPage.reload();
    await expect(reloadedSummary.getByText(role, { exact: true })).toBeVisible();
    await expect(reloadedSummary.getByText(secondaryEmail, { exact: true })).toBeVisible();
    const afterRole = await readGuest();
    expect(afterRole.currentRepresentation?.jobTitle).toBe(role);
    expect(afterRole.currentRepresentation?.email).toBe(secondaryEmail);
    // The speaker appears as the live identity they act as: its new title is all that changes.
    expect(afterRole.profile).toEqual({ ...reviewed.profile, jobTitle: role });
    expect(
      proposalAccessReadResponseSchema
        .parse(
          await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
        )
        .speakers.find((speaker) => speaker.userId === guest.userId),
    ).toEqual({ ...rosterBefore!, jobTitle: role });
    await captureResponsive(guestPage, testInfo, "current-invited-representation-role");
    // Inviting an existing person at their verified work address preserves the account and mailbox proof.
    const accountContext = await browser.newContext({ baseURL: origin });
    try {
      const accountPage = await accountContext.newPage();
      await signInToPortal(accountPage, guest.email);
      const readAddresses = async () => {
        const response = await accountPage.request.get("/api/v1/users/current/emails");
        expect(response.status()).toBe(200);
        return ownEmailAddressesListResponseSchema.parse(await response.json()).emails;
      };
      const addressesBefore = await readAddresses();
      const verifiedAlias = addressesBefore.find((address) => address.email === secondaryEmail)!;
      expect(verifiedAlias.id).toBe(secondary.id);
      expect(verifiedAlias.verifiedAt).not.toBeNull();
      const fresh = await submitProposal(page, {
        proposerEmail: `alias-invite-proposer-${crypto.randomUUID()}@example.test`,
        firstName: "Alias",
        lastName: "Proposer",
        title: `Explicit work-mail invitation ${crypto.randomUUID()}`,
        abstract: ABSTRACT,
      });
      const sinceAliasInvitation = await capturedEmailCount();
      const invitationResponse = await page.request.post(
        `/api/v1/proposals/access/${encodeURIComponent(fresh.accessToken)}/speakers`,
        { data: { email: secondaryEmail, firstName: "Guest", lastName: "Speaker", role: "speaker" } },
      );
      expect(invitationResponse.status(), await invitationResponse.text()).toBe(200);
      expect(coSpeakerInviteResponseSchema.parse(await invitationResponse.json()).email).toBe(secondaryEmail);
      const aliasMail = await waitForCapturedEmail(secondaryEmail, "Speaker invitation: please confirm", {
        since: sinceAliasInvitation,
      });
      const aliasInvitationUrl = extractEmailUrl(aliasMail, "/speaker/");
      const aliasToken = new URL(aliasInvitationUrl).searchParams.get("token")!;
      const aliasRead = await guestPage.request.get(
        `/api/v1/proposals/speakers/access/${encodeURIComponent(aliasToken)}`,
      );
      expect(aliasRead.status()).toBe(200);
      const aliasSpeaker = speakerSelfServiceReadResponseSchema.parse(await aliasRead.json());
      expect(aliasSpeaker.speaker.userId).toBe(guest.userId);
      expect(aliasSpeaker.speaker.status).toBe("invited");
      expect(aliasSpeaker.profile.email).toBe(guest.email);
      expect(aliasSpeaker.profile.actingIdentityId).toBe(guest.identityId);
      expect(aliasSpeaker.currentRepresentation?.email).toBe(secondaryEmail);
      expect(await readAddresses()).toEqual(addressesBefore);
      await guestPage.goto(aliasInvitationUrl);
      const aliasSummary = guestPage.locator("[data-speaker-identity]").locator("dl");
      await expect(aliasSummary.getByText(secondaryEmail, { exact: true })).toBeVisible();
      await expect(aliasSummary.getByText(selectedIdentity.organizationName!, { exact: true })).toBeVisible();
      await expect(guestPage.getByRole("button", { name: "Confirm participation", exact: true })).toBeVisible();
    } finally {
      await accountContext.close();
    }

    expect((await guestPage.request.get("/api/v1/auth/session")).status()).toBe(401);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
