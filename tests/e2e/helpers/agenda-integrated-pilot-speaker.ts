import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { speakerSelfServiceReadResponseSchema } from "../../../assets/shared/schemas/speaker-self-service";
import {
  coSpeakerInviteSchema,
  coSpeakerInviteResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { submitProposal, decideProposal } from "./proposals";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { completeIndependentCapacityDisclosure } from "./independent-capacity";
import { capturePilot } from "./agenda-integrated-pilot";
import { signInToPortal } from "./portal-auth";

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
  const speakerUrl = extractEmailUrl(message, "/portal/");
  const path = `/api/v1/proposals/${encodeURIComponent(proposal.proposalId)}/participation`;
  await signInToPortal(speaker, email);
  await speaker.goto(speakerUrl);
  await expect(speaker.getByRole("heading", { name: "Speaker participation" })).toBeVisible();
  const before = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(before.speaker.status).toBe("invited");
  expect(before.profile.actingIdentitySelection).toBe("unrecorded");
  expect(before.profile.email).toBe(email);
  const confirmation = speaker.getByRole("button", { name: "Confirm participation", exact: true });
  await expect(confirmation).toBeDisabled();
  const terms = speaker.locator("[data-term-key] input[type='checkbox']");
  await expect(terms.first()).toBeVisible();
  for (let i = 0; i < (await terms.count()); i++) await terms.nth(i).check();
  await speaker.getByRole("button", { name: "I'm presenting as an individual" }).click();
  await completeIndependentCapacityDisclosure(speaker);
  await speaker.getByRole("button", { name: "Save speaker identity", exact: true }).click();
  await expect(speaker.getByText("Speaker identity saved.")).toBeVisible();
  await expect(confirmation).toBeEnabled();
  const confirming = speaker.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "PATCH",
  );
  await confirmation.click();
  expect((await confirming).status()).toBe(200);
  await expect(speaker.getByText("Participation confirmed.")).toBeVisible();
  const after = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(after.speaker.status).toBe("confirmed");
  expect(after.speaker.userId).toBe(before.speaker.userId);
  expect(after.currentRepresentation?.actingIdentitySelection).toBe("individual");
  const profile = speaker.getByRole("region", { name: "Speaker profile" });
  await profile.getByRole("button", { name: "Edit", exact: true }).click();
  await profile
    .getByLabel(/speaker bio/i)
    .fill("An invited synthetic speaker reviewing the integrated publication and participation rehearsal.");
  await profile.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(speaker.getByText("Profile updated.")).toBeVisible();
  await capturePilot(speaker, info, "pilot-confirmed-speaker");
  expect(await decideProposal(staff, proposal.proposalId, "accepted")).toBe(200);
  if (!after.speaker.userId) throw new Error("The confirmed speaker needs a canonical person");
  return { ...proposal, userId: after.speaker.userId, title, email, path };
}
