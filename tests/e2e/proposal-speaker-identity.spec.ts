import { expect, test, type Page } from "@playwright/test";
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
} from "../../assets/shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { userEmailAddSchema, userEmailAddResponseSchema } from "../../assets/shared/schemas/user-emails";
import { captureResponsive } from "./helpers/proposal-speaker-identity";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { createMember } from "./helpers/member-provisioning";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { PROPOSAL_EVENT_SLUG } from "./helpers/proposals";
import { fieldLabel, acceptVisibleTerms, answerRequiredProposalFields } from "./helpers/proposal-entry-ui";

const PROPOSE_PAGE = `/events/2026/${PROPOSAL_EVENT_SLUG}/propose/`;
const PROPOSALS = `/api/v1/events/${PROPOSAL_EVENT_SLUG}/proposals`;
const ABSTRACT =
  "A practical examination of migration decisions and operational evidence, describing how teams verify representation and keep historical attribution stable as people change roles.";
const BIO = "A synthetic conference speaker with experience implementing and reviewing operational migration programs.";

async function chooseOwnedIdentity(
  page: Page,
  identity: Pick<ActingIdentity, "organizationName" | "jobTitle" | "email">,
): Promise<void> {
  const picker = page.getByRole("combobox", { name: "Your organization representation", exact: true });
  if (!(await picker.isVisible()))
    await page.getByRole("button", { name: "Choose another representation", exact: true }).click();
  await picker.fill(identity.organizationName ?? identity.email);
  const option = page.getByRole("option").filter({ hasText: actingIdentityLabel(identity) });
  await expect(option).toHaveCount(1);
  await expect(option).toBeVisible();
  await option.click();
}

test("terms-first proposals and invited speakers verify identity without duplicate personal fields", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
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
    const qualifier = ownerPage.getByRole("group", {
      name: "In what capacity are you submitting this proposal?",
      exact: true,
    });
    await expect(ownerPage.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(qualifier).toHaveCount(0);
    expect(catalogRequests).toEqual([]);
    await captureResponsive(ownerPage, testInfo, "proposal-terms-first");
    await acceptVisibleTerms(ownerPage, "[data-consents]");
    await ownerPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await expect(qualifier).toBeVisible();
    await captureResponsive(ownerPage, testInfo, "proposal-participation-qualifier");
    await qualifier
      .getByRole("radio", { name: "On behalf of an organization (my employer or my own company)", exact: true })
      .check();
    await chooseOwnedIdentity(ownerPage, ownIdentity);
    const ownSummary = ownerPage.locator("[data-proposer-identity]").locator("dl");
    await expect(ownSummary.getByText("Identity Owner", { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(own.email, { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(ownIdentity.organizationName!, { exact: true })).toBeVisible();
    await expect(ownSummary.getByText(ownIdentity.jobTitle!, { exact: true })).toBeVisible();
    for (const label of ["First name", "Last name", "Organization name", "Job title (optional)"])
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
    await otherCard.getByRole("textbox", { name: "Bio", exact: true }).fill(BIO);
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
    const guestInvitation = await waitForCapturedEmail(guest.email, "You have been added as a speaker", {
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
    await expect(
      ownerPage.getByRole("combobox", { name: "Your organization representation", exact: true }),
    ).toHaveCount(0);
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
    expect(roster.speakers.find((speaker) => speaker.userId === guest.userId)?.actingIdentitySelection).toBe(
      "unrecorded",
    );
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
    expect(afterSourceEdit.profile.jobTitle).toBe(beforeSourceEdit.profile.jobTitle);
    expect(afterSourceEdit.profile.organizationName).toBe(beforeSourceEdit.profile.organizationName);
    expect(afterSourceEdit.profile.actingIdentitySelectedAt).toBe(beforeSourceEdit.profile.actingIdentitySelectedAt);

    // A fresh individual follows terms, the join qualifier, and mailbox verification before any submission.
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
    const anonymousQualifier = guestPage.getByRole("group", {
      name: "In what capacity are you submitting this proposal?",
      exact: true,
    });
    await expect(guestPage.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(anonymousQualifier).toHaveCount(0);
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await expect(anonymousQualifier).toHaveCount(0);
    await acceptVisibleTerms(guestPage, "[data-consents]");
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    await anonymousQualifier.getByRole("radio", { name: "As an individual", exact: true }).check();
    await guestPage.getByLabel("Email address", { exact: true }).fill(anonymousEmail);
    const proofSince = await capturedEmailCount();
    const proofStart = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === `${PROPOSALS}/proof` && response.request().method() === "POST",
    );
    await guestPage.getByRole("button", { name: "Verify email", exact: true }).click();
    const started = await proofStart;
    expect(started.status()).toBe(200);
    expect(eventProposalProofStartSchema.parse(started.request().postDataJSON()).unaffiliatedAttestation).toBe(true);
    expect(eventProposalProofStartResponseSchema.parse(await started.json()).status).toBe("verification_sent");
    expect(initialProposalRequests).toEqual([]);
    expect(await userCount()).toBe(0);
    const proofMail = await waitForCapturedEmail(anonymousEmail, "Verify your email for", { since: proofSince });
    await guestPage.goto(extractEmailUrl(proofMail, "/propose/"));
    await expect(anonymousQualifier).toHaveCount(0);
    const proofVerify = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST",
    );
    await acceptVisibleTerms(guestPage, "[data-consents]");
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
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
    const guestQualifier = guestPage.getByRole("group", {
      name: "In what capacity are you presenting?",
      exact: true,
    });
    await expect(guestPage.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
    await expect(guestQualifier).toHaveCount(0);
    await expect(
      guestPage.getByRole("combobox", { name: "Your organization representation", exact: true }),
    ).toHaveCount(0);
    expect(guestCatalogRequests).toEqual([]);
    const invited = await readGuest();
    expect(invited.speaker.userId).toBe(guest.userId);
    expect(invited.speaker.status).toBe("invited");
    expect(invited.profile.actingIdentitySelection).toBe("unrecorded");
    expect(invited.profile.actingIdentityId).toBeNull();
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
    await expect(ownerPage.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
    await acceptVisibleTerms(ownerPage, "[data-speaker-consents]");
    const wrongQualifier = ownerPage.getByRole("group", {
      name: "In what capacity are you presenting?",
      exact: true,
    });
    await wrongQualifier
      .getByRole("radio", { name: "On behalf of an organization (my employer or my own company)", exact: true })
      .check();
    await expect(
      ownerPage.getByRole("combobox", { name: "Your organization representation", exact: true }),
    ).toHaveCount(0);
    expect(catalogRequests).toHaveLength(beforeWrongUser);
    expect((await ownerPage.request.get(`${guestSpeakerPath}/identities`)).status()).toBe(403);
    const wrongUserSelection = await ownerPage.request.patch(`${guestSpeakerPath}/profile`, {
      data: speakerSelfProfilePatchSchema.parse({ actingIdentityId: guest.identityId }),
    });
    expect(wrongUserSelection.status()).toBe(403);
    expect((await readGuest()).profile).toEqual(invited.profile);

    // The invitation holder can verify their official mailbox without establishing a global portal session.
    const confirmation = guestPage.getByRole("button", { name: "Confirm participation", exact: true });
    await expect(confirmation).toBeDisabled();
    await acceptVisibleTerms(guestPage, "[data-speaker-consents]");
    await guestQualifier
      .getByRole("radio", { name: "On behalf of an organization (my employer or my own company)", exact: true })
      .check();
    await guestPage.getByLabel("Work email address", { exact: true }).fill(secondaryEmail);
    await captureResponsive(guestPage, testInfo, "invited-speaker-work-proof");
    const speakerProofSince = await capturedEmailCount();
    const speakerProofStart = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === `${PROPOSALS}/proof` && response.request().method() === "POST",
    );
    await guestPage.getByRole("button", { name: "Verify work email", exact: true }).click();
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
    await guestPage.goto(emailedProofUrl);
    await expect(guestPage.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
    await expect(guestQualifier).toHaveCount(0);
    const resumeProof = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST",
    );
    await acceptVisibleTerms(guestPage, "[data-consents]");
    await guestPage.getByRole("button", { name: "Continue →", exact: true }).click();
    const resumedProof = await resumeProof;
    expect(resumedProof.status()).toBe(200);
    const resumeInput = eventProposalProofVerifySchema.parse(resumedProof.request().postDataJSON());
    expect(resumeInput.token).toBe(emailedProofToken);
    expect(resumeInput.speakerManagementToken).toBeUndefined();
    // This response immediately navigates; inspect its request and the destination's verified state.
    await expect(guestPage.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
    await expect(guestQualifier).toHaveCount(0);
    const speakerProofVerify = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${PROPOSALS}/proof/verify` && response.request().method() === "POST",
    );
    await acceptVisibleTerms(guestPage, "[data-speaker-consents]");
    const speakerVerified = await speakerProofVerify;
    expect(speakerVerified.status()).toBe(200);
    const speakerVerifyInput = eventProposalProofVerifySchema.parse(speakerVerified.request().postDataJSON());
    expect(speakerVerifyInput.token).toBe(emailedProofToken);
    expect(speakerVerifyInput.speakerManagementToken).toBe(new URL(guestPage.url()).searchParams.get("token"));
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
    for (const label of ["First name", "Last name", "Organization name", "Job title (optional)"])
      await expect(
        guestPage.locator("[data-speaker-identity]").getByRole("textbox", { name: fieldLabel(label) }),
      ).toHaveCount(0);
    const guestBiography = `${BIO} These program details were reviewed through the invitation link.`;
    await guestPage.getByRole("textbox", { name: "Biography", exact: true }).fill(guestBiography);
    const save = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${guestSpeakerPath}/profile` && response.request().method() === "PATCH",
    );
    await guestPage.getByRole("button", { name: "Save profile", exact: true }).click();
    const saved = await save;
    expect(saved.status()).toBe(200);
    const savedInput = speakerSelfProfilePatchSchema.parse(saved.request().postDataJSON());
    expect(savedInput.continuationToken).toBe(verifiedSpeaker.continuationToken);
    expect(savedInput.actingIdentityId).toBe(guest.identityId);
    expect(savedInput.unaffiliatedAttestation).toBe(false);
    const recorded = await readGuest();
    expect(recorded.profile.actingIdentitySelection).toBe("identity");
    expect(recorded.profile.organizationName).toBe(selectedIdentity.organizationName);
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
    await expect(
      guestPage.getByRole("combobox", { name: "Your organization representation", exact: true }),
    ).toHaveCount(0);
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
    const frozenRoster = proposalAccessReadResponseSchema
      .parse(
        await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
      )
      .speakers.find((speaker) => speaker.userId === guest.userId);
    const role = "Updated verified speaker role";
    const rolePath = `${PROPOSALS}/proof/identities/${selectedIdentity.id}`;
    await guestPage.getByRole("button", { name: "Update current representation", exact: true }).click();
    const roleInput = guestPage.getByLabel(fieldLabel("Job title (optional)"));
    await roleInput.fill(role);
    const roleSave = guestPage.waitForResponse(
      (response) => new URL(response.url()).pathname === rolePath && response.request().method() === "PATCH",
    );
    await guestPage.getByRole("button", { name: "Save representation", exact: true }).click();
    const roleResponse = await roleSave;
    expect(roleResponse.status()).toBe(200);
    expect(eventProposalProofIdentityPatchSchema.parse(roleResponse.request().postDataJSON())).toEqual({
      jobTitle: role,
      speakerManagementToken: returnedToken,
    });
    expect(eventProposalProofIdentityPatchResponseSchema.parse(await roleResponse.json())).toEqual({
      identityId: selectedIdentity.id,
      jobTitle: role,
    });
    await expect(reloadedSummary.getByText(role, { exact: true })).toBeVisible();
    await guestPage.getByRole("button", { name: "Update current representation", exact: true }).click();
    await expect(roleInput).toHaveValue(role);
    await guestPage.getByRole("button", { name: "Cancel", exact: true }).click();
    await guestPage.reload();
    await expect(reloadedSummary.getByText(role, { exact: true })).toBeVisible();
    await expect(reloadedSummary.getByText(secondaryEmail, { exact: true })).toBeVisible();
    const afterRole = await readGuest();
    expect(afterRole.currentRepresentation?.jobTitle).toBe(role);
    expect(afterRole.currentRepresentation?.email).toBe(secondaryEmail);
    expect(afterRole.profile).toEqual(reviewed.profile);
    expect(
      proposalAccessReadResponseSchema
        .parse(
          await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
        )
        .speakers.find((speaker) => speaker.userId === guest.userId),
    ).toEqual(frozenRoster);
    await captureResponsive(guestPage, testInfo, "current-invited-representation-role");
    expect((await guestPage.request.get("/api/v1/auth/session")).status()).toBe(401);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
