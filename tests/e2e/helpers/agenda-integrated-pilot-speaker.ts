import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import {
  speakerSelfServiceReadResponseSchema,
  speakerProfileUpdateResponseSchema,
} from "../../../assets/shared/schemas/speaker-self-service";
import {
  speakerSelfProfilePatchSchema,
  coSpeakerInviteSchema,
  coSpeakerInviteResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import {
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifyResponseSchema,
} from "../../../assets/shared/schemas/event-proposal-proof";
import { EMAIL_FIRST_COPY } from "../../../assets/shared/email-first-copy";
import { submitProposal, decideProposal } from "./proposals";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { acceptVisibleTerms } from "./proposal-entry-ui";
import { confirmSpeakerWithReceipt } from "./speaker-participation-receipt";
import { sponsorEventSlug } from "./sponsor-live-fixture";
import { completeIndependentCapacityDisclosure } from "./independent-capacity";
import { capturePilot } from "./agenda-integrated-pilot";

/** The speaker's actual proof/confirmation feeds the accepted source imported into this same agenda. */
export async function preparePilotSpeaker(staff: Page, speaker: Page, info: TestInfo) {
  const email = `integrated-speaker-${randomUUID()}@example.test`;
  const title = `Integrated speaker session ${randomUUID()}`;
  const proposal = await submitProposal(staff, {
    proposerEmail: `integrated-proposer-${randomUUID()}@example.test`,
    firstName: "Integrated",
    lastName: "Proposer",
    title,
    abstract:
      "A synthetic discussion of canonical publication, accountable participation and preserved evidence across an integrated conference rehearsal.",
  });
  // The verified proposer already agreed to speaker terms at submission; invite a distinct person for confirmation.
  const since = await capturedEmailCount();
  const invitation = await speaker.request.post(`/api/v1/proposals/access/${proposal.accessToken}/speakers`, {
    data: coSpeakerInviteSchema.parse({ email, firstName: "Integrated", lastName: "Speaker", role: "speaker" }),
  });
  expect(invitation.status(), await invitation.text()).toBe(200);
  expect(coSpeakerInviteResponseSchema.parse(await invitation.json()).email).toBe(email);
  const message = await waitForCapturedEmail(email, "You have been added as a speaker", { since });
  const speakerUrl = extractEmailUrl(message, "/speaker/");
  const token = new URL(speakerUrl).searchParams.get("token");
  if (!token) throw new Error("The speaker must use their own emailed capability");
  let path = `/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`;
  await speaker.goto(speakerUrl);
  const before = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(before.speaker.status).toBe("invited");
  expect(before.profile.actingIdentitySelection).toBe("unrecorded");
  expect(before.currentRepresentation).toBeNull();
  expect(before.profile.email).toBe(email);
  await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeDisabled();
  await expect(speaker.locator("[data-speaker-consents]").getByRole("checkbox").first()).toBeVisible();
  await acceptVisibleTerms(speaker, "[data-speaker-consents]");
  // The individual path is the email step's personal card; the disclosure follows the mailbox proof.
  const identity = speaker.locator("[data-speaker-identity]");
  await identity.getByRole("radio", { name: EMAIL_FIRST_COPY.speaker.personal.title, exact: true }).check();
  await identity.getByRole("textbox", { name: EMAIL_FIRST_COPY.speaker.personal.label, exact: true }).fill(email);
  const proofSince = await capturedEmailCount();
  const proofPath = `/api/v1/events/${sponsorEventSlug}/proposals/proof`;
  const starting = speaker.waitForResponse(
    (response) => new URL(response.url()).pathname === proofPath && response.request().method() === "POST",
  );
  const verifying = speaker.waitForResponse(
    (response) => new URL(response.url()).pathname === `${proofPath}/verify` && response.request().method() === "POST",
  );
  await identity.getByRole("button", { name: EMAIL_FIRST_COPY.speaker.personal.action, exact: true }).click();
  // The invitation link already proved the invited mailbox: the proof starts verified, without a second email.
  const started = await starting;
  expect(started.status(), await started.text()).toBe(200);
  expect(eventProposalProofStartResponseSchema.parse(await started.json()).status).toBe("verified");
  const verified = await verifying;
  await expect(speaker.getByRole("button", { name: "Save speaker identity", exact: true })).toBeVisible();
  expect(await capturedEmailCount()).toBe(proofSince);
  const returnedToken = new URL(speaker.url()).searchParams.get("token");
  if (!returnedToken) throw new Error("Verified invitation must resume its own speaker capability");
  path = `/api/v1/proposals/speakers/access/${encodeURIComponent(returnedToken)}`;
  expect(verified.status(), await verified.text()).toBe(200);
  expect(eventProposalProofVerifyResponseSchema.parse(await verified.json())).toMatchObject({
    status: "ready",
    email,
    applicantKind: "individual",
  });
  await completeIndependentCapacityDisclosure(speaker.locator("[data-speaker-identity]"));
  const saving = speaker.waitForResponse(
    (response) => new URL(response.url()).pathname === `${path}/profile` && response.request().method() === "PATCH",
  );
  await speaker.getByRole("button", { name: "Save speaker identity", exact: true }).click();
  const saved = await saving;
  expect(saved.status(), await saved.text()).toBe(200);
  expect(speakerSelfProfilePatchSchema.parse(saved.request().postDataJSON())).toMatchObject({
    actingIdentityId: null,
    unaffiliatedAttestation: true,
    independentCapacity: { organizationConnection: "no" },
  });
  const selected = speakerProfileUpdateResponseSchema.parse(await saved.json());
  expect(selected.currentRepresentation?.actingIdentitySelection).toBe("individual");
  expect(selected.currentRepresentation?.email).toBe(email);
  await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeEnabled();
  await confirmSpeakerWithReceipt(speaker, path);
  const after = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(after.speaker.status).toBe("confirmed");
  expect(after.speaker.userId).toBe(before.speaker.userId);
  expect(after.currentRepresentation).toEqual(selected.currentRepresentation);
  // The biography belongs to the identity the speaker speaks as and is edited on that identity once it is chosen.
  const identityProfile = speaker.locator("[data-identity-profile-form]");
  const profileSaving = speaker.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.includes("/proposals/proof/identities/") &&
      response.request().method() === "PATCH",
  );
  await identityProfile
    .getByRole("textbox", { name: "Your speaker bio", exact: true })
    .fill("An invited synthetic speaker reviewing the integrated publication and participation rehearsal.");
  await identityProfile.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await profileSaving).status()).toBe(200);
  await capturePilot(speaker, info, "pilot-confirmed-speaker");
  expect(await decideProposal(staff, proposal.proposalId, "accepted")).toBe(200);
  if (!after.speaker.userId) throw new Error("The confirmed speaker needs a canonical person");
  return { ...proposal, userId: after.speaker.userId, title, email, path };
}
