/**
 * What a proposer may still change, and when.
 *
 * The existing proposal journey is thorough but happens entirely while the
 * proposal is `submitted`. The interesting rules are the ones that differ by
 * state: the speaker roster stays editable after acceptance
 * (`PROPOSAL_SPEAKER_ROSTER_EDITABLE_STATUSES` includes `accepted`) while the
 * title and abstract do not (`PROPOSAL_SELF_SERVICE_EDITABLE_STATUSES` does
 * not), and a rejected proposal closes both. Nothing exercised that, so an
 * accepted session's abstract could have drifted after the program was
 * published without anything failing.
 *
 * @covers proposal.4.2
 * @covers proposal.4.3
 * @covers proposal.4.4
 * @covers proposal.4.5
 */
import { expect, test } from "@playwright/test";

/**
 * Refusal codes for a self-service action the proposal's state forbids. The
 * exact code differs by endpoint — the guarantee under test is that the action
 * is refused, not which of these it answers with.
 */
const REFUSED = [400, 403, 409, 422];
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { ensureAppOrigin, uniqueSuffix } from "./helpers/membership";
import {
  decideProposal,
  inviteCoSpeaker,
  patchProposalAsProposer,
  readProposalAccess,
  removeSpeaker,
  submitProposal,
  updateSpeaker,
} from "./helpers/proposals";

const LONG_ABSTRACT =
  "An abstract long enough to satisfy the shared proposal validation rules, describing the migration choices, " +
  "governance controls, and delivery trade-offs a team faces when moving critical infrastructure forward.";

test("a proposer can add, update, and remove a co-speaker while the proposal is open", async ({ page }) => {
  const suffix = uniqueSuffix();
  const proposerEmail = `proposer-open-${suffix}@proposer-open-${suffix}.test`;
  const coSpeakerEmail = `cospeaker-open-${suffix}@cospeaker-open-${suffix}.test`;
  await ensureAppOrigin(page);

  const { accessToken } = await submitProposal(page, {
    proposerEmail,
    firstName: "Open",
    lastName: "Proposer",
    title: `Roster changes while open ${suffix}`,
    abstract: LONG_ABSTRACT,
  });

  expect(
    await inviteCoSpeaker(page, accessToken, {
      email: coSpeakerEmail,
      firstName: "Co",
      lastName: "Speaker",
    }),
  ).toBe(200);

  const withCoSpeaker = await readProposalAccess(page, accessToken);
  expect(withCoSpeaker.status).toBe(200);
  const added = withCoSpeaker.body.speakers?.find((speaker) => speaker.email === coSpeakerEmail);
  expect(added, JSON.stringify(withCoSpeaker.body.speakers)).toBeTruthy();

  expect(await updateSpeaker(page, accessToken, added!.userId, { jobTitle: "Principal Engineer" })).toBe(200);

  // Removing them again is the half nothing covered: a proposer who invites
  // the wrong person must be able to undo it themselves.
  expect(await removeSpeaker(page, accessToken, added!.userId)).toBe(200);
  const afterRemoval = await readProposalAccess(page, accessToken);
  expect(afterRemoval.body.speakers?.some((speaker) => speaker.email === coSpeakerEmail)).toBe(false);
});

test("the title and abstract are editable while open", async ({ page }) => {
  const suffix = uniqueSuffix();
  const proposerEmail = `proposer-edit-${suffix}@proposer-edit-${suffix}.test`;
  await ensureAppOrigin(page);

  const { accessToken } = await submitProposal(page, {
    proposerEmail,
    firstName: "Editing",
    lastName: "Proposer",
    title: `Editable while open ${suffix}`,
    abstract: LONG_ABSTRACT,
  });

  const revisedTitle = `Revised while open ${suffix}`;
  expect(
    await patchProposalAsProposer(page, accessToken, {
      title: revisedTitle,
      abstract: `${LONG_ABSTRACT} It has since been revised by its proposer.`,
    }),
  ).toBe(200);

  const updated = await readProposalAccess(page, accessToken);
  expect(updated.body.proposal?.title).toBe(revisedTitle);
});

test("acceptance freezes the abstract but keeps the speaker roster editable", async ({ page }) => {
  const suffix = uniqueSuffix();
  const proposerEmail = `proposer-accepted-${suffix}@proposer-accepted-${suffix}.test`;
  const lateSpeakerEmail = `late-speaker-${suffix}@late-speaker-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());
  await ensureAppOrigin(page);

  const { accessToken, proposalId } = await submitProposal(page, {
    proposerEmail,
    firstName: "Accepted",
    lastName: "Proposer",
    title: `Accepted session ${suffix}`,
    abstract: LONG_ABSTRACT,
  });

  await signInToPortal(page, e2eAdminEmail("portal-proposal-states"));
  expect(await decideProposal(page, proposalId, "accepted")).toBe(200);
  await page.context().clearCookies();
  await ensureAppOrigin(page);

  const accepted = await readProposalAccess(page, accessToken);
  expect(accepted.body.proposal?.status).toBe("accepted");

  // A published programme must not shift under the attendees who chose it.
  const frozen = await patchProposalAsProposer(page, accessToken, { title: `Retitled after acceptance ${suffix}` });
  expect(REFUSED, `editing an accepted abstract returned ${frozen}`).toContain(frozen);

  const unchanged = await readProposalAccess(page, accessToken);
  expect(unchanged.body.proposal?.title).toBe(`Accepted session ${suffix}`);

  // The roster is deliberately different: speakers change late, and the
  // proposer must still be able to say who is actually presenting.
  expect(
    await inviteCoSpeaker(page, accessToken, {
      email: lateSpeakerEmail,
      firstName: "Late",
      lastName: "Addition",
    }),
    "an accepted session must still accept a speaker change",
  ).toBe(200);

  const withLateSpeaker = await readProposalAccess(page, accessToken);
  const late = withLateSpeaker.body.speakers?.find((speaker) => speaker.email === lateSpeakerEmail);
  expect(late).toBeTruthy();
  expect(await removeSpeaker(page, accessToken, late!.userId)).toBe(200);
});

test("a rejected proposal closes both the content and the roster", async ({ page }) => {
  const suffix = uniqueSuffix();
  const proposerEmail = `proposer-rejected-${suffix}@proposer-rejected-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());
  await ensureAppOrigin(page);

  const { accessToken, proposalId } = await submitProposal(page, {
    proposerEmail,
    firstName: "Rejected",
    lastName: "Proposer",
    title: `Rejected session ${suffix}`,
    abstract: LONG_ABSTRACT,
  });

  await signInToPortal(page, e2eAdminEmail("portal-proposal-states-rejected"));
  expect(await decideProposal(page, proposalId, "rejected")).toBe(200);
  await page.context().clearCookies();
  await ensureAppOrigin(page);

  const edited = await patchProposalAsProposer(page, accessToken, { title: `Retitled after rejection ${suffix}` });
  expect(REFUSED, `editing a rejected proposal returned ${edited}`).toContain(edited);

  const invited = await inviteCoSpeaker(page, accessToken, {
    email: `rejected-cospeaker-${suffix}@rejected-cospeaker-${suffix}.test`,
    firstName: "Rejected",
    lastName: "CoSpeaker",
  });
  expect(REFUSED, `inviting onto a rejected proposal returned ${invited}`).toContain(invited);
});
