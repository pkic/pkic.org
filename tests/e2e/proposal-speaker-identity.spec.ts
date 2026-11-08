import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { expect, test, type Page } from "@playwright/test";
import { actingIdentityLabel } from "../../assets/ts/shared/acting-identity-catalog";
import {
  userUpdateSchema,
  userDetailResponseSchema,
  usersListResponseSchema,
} from "../../assets/shared/schemas/user-management";
import {
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
    userEmailAddResponseSchema.parse(await addedEmail.json());
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
    const guestInvitation = await waitForCapturedEmail(guest.email, "You have been added as a speaker", {
      since: sinceOwn,
    });
    const guestSpeakerUrl = extractEmailUrl(guestInvitation, "/portal/");
    const ownMail = await waitForCapturedEmail(own.email, "proposal", { since: sinceOwn });
    const manageUrl = extractEmailUrl(ownMail, "/propose/manage/");
    const ownSpeakerPath = `/api/v1/proposals/${encodeURIComponent(created.proposalId!)}/participation`;
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

    // The invitation identifies its recipient even if the proposer opens it while signed in.
    await ownerPage.goto(guestSpeakerUrl);
    await expect(ownerPage.getByText(/invitation is for a different account/i)).toBeVisible();
    await signInToPortal(guestPage, guest.email);
    await guestPage.goto(guestSpeakerUrl);
    await expect(guestPage.getByRole("heading", { name: "Speaker participation" })).toBeVisible();
    const guestSpeakerPath = `/api/v1/proposals/${encodeURIComponent(created.proposalId!)}/participation`;
    const readGuest = async () => {
      const response = await guestPage.request.get(guestSpeakerPath);
      expect(response.status(), await response.text()).toBe(200);
      return speakerSelfServiceReadResponseSchema.parse(await response.json());
    };
    const invited = await readGuest();
    expect(invited.speaker).toMatchObject({ userId: guest.userId, status: "invited" });
    expect(invited.profile.actingIdentityId).toBe(guest.identityId);
    expect(invited.profile.organizationName).toBe(guestIdentity.organizationName);
    const confirmation = guestPage.getByRole("button", { name: "Confirm willingness to participate", exact: true });
    await expect(confirmation).toBeDisabled();
    const terms = guestPage.locator("[data-term-key] input[type='checkbox']");
    await expect(terms.first()).toBeVisible();
    for (let i = 0; i < (await terms.count()); i++) await terms.nth(i).check();
    await expect(confirmation).toBeEnabled();
    await confirmation.click();
    await expect(
      guestPage.getByText(
        "Your willingness to participate in this proposal is confirmed. Committee acceptance and scheduling are separate decisions.",
      ),
    ).toBeVisible();
    const confirmed = await readGuest();
    expect(confirmed.speaker).toMatchObject({ userId: guest.userId, status: "confirmed" });
    expect(confirmed.profile.actingIdentityId).toBe(guest.identityId);
    const profile = guestPage.getByRole("region", { name: "Speaker profile" });
    await profile.getByRole("button", { name: "Edit", exact: true }).click();
    await profile.getByLabel(/speaker bio/i).fill(BIO);
    await profile.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(guestPage.getByText("Profile updated.")).toBeVisible();
    await guestPage.reload();
    await expect(profile.getByText(BIO)).toBeVisible();
    expect((await readGuest()).profile.biography).toBe(BIO);
    const updatedRoster = proposalAccessReadResponseSchema.parse(
      await (await ownerPage.request.get(`/api/v1/proposals/access/${encodeURIComponent(proposerToken)}`)).json(),
    );
    expect(updatedRoster.speakers.find((speaker) => speaker.userId === guest.userId)).toMatchObject({
      actingIdentityId: guest.identityId,
      status: "confirmed",
    });
    await captureResponsive(guestPage, testInfo, "confirmed-account-speaker");
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
