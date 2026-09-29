/**
 * Voting as members actually experience it.
 *
 * The existing vote journeys create a vote as staff and read the public pages.
 * Nobody ever cast a ballot in a browser, so the rules that matter to a voter
 * were unproved: that a person representing two organizations gets a separate
 * ballot for each and neither overwrites the other, that changing your mind
 * replaces your ballot rather than adding one, that both vote types work, and
 * that the window and eligibility close the ballot box when they should.
 *
 * @covers vote.5.1
 * @covers vote.5.2
 * @covers vote.5.3
 * @covers vote.5.4
 * @covers vote.5.5
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, readActiveIdentities, uniqueSuffix } from "./helpers/membership";

/** Every approved member is automatically enrolled here, so it is the natural electorate. */
const ALL_MEMBERS_GROUP = "20000000-0000-4000-8000-000000000001";

interface VoteSetup {
  voteType: "motion" | "election";
  title: string;
  opensAt?: string;
  closesAt: string;
  eligibleCategories?: string[] | null;
  /** `per_member` gives one ballot per represented Member; `per_person` one per person. */
  electorateMode?: "per_member" | "per_person";
  candidates?: Array<{ name: string; bio?: string }>;
}

async function createVote(page: Page, setup: VoteSetup): Promise<{ id: string; slug: string }> {
  const created = await page.evaluate(
    async ({ groupId, setup }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: setup.title,
          voteType: setup.voteType,
          electorateMode: setup.electorateMode ?? "per_member",
          thresholdType: "simple_majority",
          ...(setup.opensAt ? { opensAt: setup.opensAt } : {}),
          closesAt: setup.closesAt,
          ...(setup.eligibleCategories !== undefined ? { eligibleCategories: setup.eligibleCategories } : {}),
          ...(setup.candidates ? { candidates: setup.candidates } : {}),
        }),
      });
      return { status: response.status, body: (await response.json()) as { vote: { id: string; slug: string } } };
    },
    { groupId: ALL_MEMBERS_GROUP, setup },
  );
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  return created.body.vote;
}

async function readMemberVote(page: Page, voteId: string) {
  const result = await page.evaluate(
    async ({ groupId, voteId }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes/${voteId}`, { credentials: "same-origin" });
      return {
        status: response.status,
        body: (await response.json()) as {
          vote: {
            status: string;
            canCastBallot: boolean;
            hasCastBallot: boolean;
            memberBallots: Array<{ memberId: string; organizationName: string; hasCastBallot: boolean }> | null;
            candidates: Array<{ id: string; candidateName: string }> | null;
          };
        },
      };
    },
    { groupId: ALL_MEMBERS_GROUP, voteId },
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.vote;
}

async function castBallot(page: Page, voteId: string, choice: string, memberId?: string): Promise<number> {
  return page.evaluate(
    async ({ groupId, voteId, choice, memberId }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes/${voteId}/ballots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ choice, ...(memberId ? { memberId } : {}) }),
      });
      return response.status;
    },
    { groupId: ALL_MEMBERS_GROUP, voteId, choice, memberId },
  );
}

async function switchIdentity(page: Page, identityId: string): Promise<void> {
  const status = await page.evaluate(async (selectedIdentityId) => {
    const response = await fetch("/api/v1/users/current/identities/active", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ identityId: selectedIdentityId }),
    });
    return response.status;
  }, identityId);
  expect(status).toBe(200);
}

function inAnHour(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}
function inADay(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}

test("a person representing two organizations casts a separate ballot for each", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `two-ballots-${suffix}@two-ballots-${suffix}.test`;
  const firstOrganization = `Ballot Org One ${suffix}`;
  const secondOrganization = `Ballot Org Two ${suffix}`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-vote-participation"));
  await approveMemberThroughReview(page, {
    email,
    name: `Two Ballot Voter ${suffix}`,
    organizationName: firstOrganization,
  });
  const secondOrg = await page.evaluate(
    async ({ organizationName, email }) => {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: organizationName,
          membershipCategory: "F",
          memberSince: "2026-01-15",
          identities: [{ name: "Two Ballot Voter", email, jobTitle: "Delegate" }],
          activationReason: "E2E multi-identity voting coverage",
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { organizationName: secondOrganization, email },
  );
  expect(secondOrg.status, JSON.stringify(secondOrg.body)).toBe(201);

  const vote = await createVote(page, {
    voteType: "motion",
    title: `Separate Member ballots ${suffix}`,
    closesAt: inADay(),
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto(`/portal/#/groups/${ALL_MEMBERS_GROUP}/votes/${vote.id}`);

  // Each action is authorized through one exact acting identity. The same user
  // can switch identities and submit the independent ballot of each Member.
  const identities = await readActiveIdentities(page);
  expect(identities).toHaveLength(2);
  const names = identities.map((identity) => identity.organizationName);
  expect(names).toContain(firstOrganization);
  expect(names).toContain(secondOrganization);

  const first = identities.find((identity) => identity.organizationName === firstOrganization)!;
  const second = identities.find((identity) => identity.organizationName === secondOrganization)!;
  await switchIdentity(page, first.identityId);
  const firstBallot = await readMemberVote(page, vote.id);
  expect(firstBallot.memberBallots).toEqual([
    expect.objectContaining({ memberId: first.memberId, organizationName: firstOrganization, hasCastBallot: false }),
  ]);
  expect(await castBallot(page, vote.id, "in_favor", first.memberId)).toBe(200);

  await switchIdentity(page, second.identityId);
  const secondBallot = await readMemberVote(page, vote.id);
  expect(secondBallot.memberBallots).toEqual([
    expect.objectContaining({ memberId: second.memberId, organizationName: secondOrganization, hasCastBallot: false }),
  ]);
  expect(await castBallot(page, vote.id, "opposed", second.memberId)).toBe(200);

  await switchIdentity(page, first.identityId);
  expect((await readMemberVote(page, vote.id)).memberBallots).toEqual([
    expect.objectContaining({ memberId: first.memberId, hasCastBallot: true }),
  ]);
  await switchIdentity(page, second.identityId);
  expect((await readMemberVote(page, vote.id)).memberBallots).toEqual([
    expect.objectContaining({ memberId: second.memberId, hasCastBallot: true }),
  ]);
});

test("changing your mind replaces your ballot instead of adding one", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `replace-ballot-${suffix}@replace-ballot-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-vote-replacement"));
  await approveMemberThroughReview(page, {
    email,
    name: `Replacing Voter ${suffix}`,
    organizationName: `Replacing Org ${suffix}`,
  });
  const vote = await createVote(page, {
    voteType: "motion",
    title: `Ballot replacement ${suffix}`,
    // The window has to outlast two magic-link sign-ins and both ballots: this
    // test closes the vote explicitly below, and an eight-second window instead
    // expired on the clock, so the close transition found nothing open.
    closesAt: inADay(),
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  const memberships = await readActiveIdentities(page);
  const memberId = memberships[0].memberId;

  expect(await castBallot(page, vote.id, "in_favor", memberId)).toBe(200);
  expect(await castBallot(page, vote.id, "abstain", memberId)).toBe(200);

  // Close the vote as staff and read the tally: a replaced ballot must count
  // once, as the voter's final answer.
  await page.context().clearCookies();
  await signInToPortal(page, e2eAdminEmail("portal-vote-replacement"));
  const closed = await page.evaluate(
    async ({ groupId, voteId }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes/${voteId}/transitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ transition: "close" }),
      });
      return { status: response.status, body: await response.json() };
    },
    { groupId: ALL_MEMBERS_GROUP, voteId: vote.id },
  );
  expect(closed.status, JSON.stringify(closed.body)).toBe(200);

  const results = await page.evaluate(
    async ({ groupId, voteId }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes/${voteId}/results`, {
        credentials: "same-origin",
      });
      return {
        status: response.status,
        body: (await response.json()) as {
          result: { counts: { in_favor: number; opposed: number; abstain: number } };
        },
      };
    },
    { groupId: ALL_MEMBERS_GROUP, voteId: vote.id },
  );
  expect(results.status, JSON.stringify(results.body)).toBe(200);
  expect(results.body.result.counts.abstain).toBe(1);
  expect(results.body.result.counts.in_favor, "the replaced choice must not still be counted").toBe(0);
});

test("an election is decided by choosing from the candidate list", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `election-voter-${suffix}@election-voter-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-vote-election"));
  await approveMemberThroughReview(page, {
    email,
    name: `Election Voter ${suffix}`,
    organizationName: `Election Org ${suffix}`,
  });
  const vote = await createVote(page, {
    voteType: "election",
    title: `Election ${suffix}`,
    closesAt: inADay(),
    candidates: [
      { name: `Candidate Ada ${suffix}`, bio: "Standing for the board." },
      { name: `Candidate Grace ${suffix}`, bio: "Also standing." },
    ],
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto(`/portal/#/groups/${ALL_MEMBERS_GROUP}/votes/${vote.id}`);

  const detail = await readMemberVote(page, vote.id);
  expect(detail.candidates?.length, "an election must offer its candidates").toBe(2);
  await expect(page.getByText(`Candidate Ada ${suffix}`, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // A motion answer is meaningless for an election and must be refused.
  const memberships = await readActiveIdentities(page);
  const memberId = memberships[0].memberId;
  expect(await castBallot(page, vote.id, "in_favor", memberId), "a motion choice is not a candidate").toBe(422);

  const candidateId = detail.candidates![0].id;
  expect(await castBallot(page, vote.id, candidateId, memberId)).toBe(200);
  const after = await readMemberVote(page, vote.id);
  expect(after.memberBallots!.some((ballot) => ballot.hasCastBallot)).toBe(true);
});

test("the ballot box is shut before the window opens and after it closes", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `window-voter-${suffix}@window-voter-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-vote-window"));
  await approveMemberThroughReview(page, {
    email,
    name: `Window Voter ${suffix}`,
    organizationName: `Window Org ${suffix}`,
  });

  const scheduled = await createVote(page, {
    voteType: "motion",
    title: `Not open yet ${suffix}`,
    opensAt: inAnHour(),
    closesAt: inADay(),
  });
  const closing = await createVote(page, {
    voteType: "motion",
    title: `Closing now ${suffix}`,
    closesAt: inADay(),
  });
  const closedResponse = await page.evaluate(
    async ({ groupId, voteId }) => {
      const response = await fetch(`/api/v1/groups/${groupId}/votes/${voteId}/transitions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ transition: "close" }),
      });
      return response.status;
    },
    { groupId: ALL_MEMBERS_GROUP, voteId: closing.id },
  );
  expect(closedResponse).toBe(200);

  await page.context().clearCookies();
  await signInToPortal(page, email);
  const memberships = await readActiveIdentities(page);
  const memberId = memberships[0].memberId;

  await page.goto(`/portal/#/groups/${ALL_MEMBERS_GROUP}/votes/${scheduled.id}`);
  await expect(page.getByText("Voting hasn't opened yet.")).toBeVisible({ timeout: 15_000 });
  const beforeWindow = await castBallot(page, scheduled.id, "in_favor", memberId);
  expect([403, 409, 422], `casting before the window returned ${beforeWindow}`).toContain(beforeWindow);

  const afterWindow = await castBallot(page, closing.id, "in_favor", memberId);
  expect([403, 409, 422], `casting after the close returned ${afterWindow}`).toContain(afterWindow);
});

test("a member outside the eligible categories is told so and cannot cast", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `ineligible-${suffix}@ineligible-${suffix}.test`;
  page.on("dialog", (dialog) => void dialog.accept());

  await signInToPortal(page, e2eAdminEmail("portal-vote-eligibility"));
  await approveMemberThroughReview(page, {
    email,
    name: `Ineligible Voter ${suffix}`,
    organizationName: `Ineligible Org ${suffix}`,
    category: "F",
  });

  // Restrict the electorate to a category this member does not hold.
  const vote = await createVote(page, {
    voteType: "motion",
    title: `Restricted electorate ${suffix}`,
    closesAt: inADay(),
    eligibleCategories: ["A"],
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto(`/portal/#/groups/${ALL_MEMBERS_GROUP}/votes/${vote.id}`);

  const detail = await readMemberVote(page, vote.id);
  expect(detail.canCastBallot, "category F must not be eligible for an A-only vote").toBe(false);
  expect(detail.memberBallots ?? []).toEqual([]);

  const refused = await castBallot(page, vote.id, "in_favor");
  expect([403, 409, 422], `an ineligible cast returned ${refused}`).toContain(refused);
});
