import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import { isAppError } from "../functions/_lib/errors";
import {
  groupVoteDetailResponseSchema,
  groupVoteResultsResponseSchema,
  groupVotesListResponseSchema,
} from "../assets/shared/schemas/group-votes";
import {
  groupVoteBallotsAuditResponseSchema,
  groupVoteLifecycleTransitionResponseSchema,
  groupVoteMutationResponseSchema,
} from "../assets/shared/schemas/group-vote-management";
import {
  groupVoteProposalApproveResponseSchema,
  groupVoteProposalCreateResponseSchema,
  groupVoteProposalDetailResponseSchema,
  groupVoteProposalEndorseResponseSchema,
  groupVoteProposalRejectResponseSchema,
  groupVoteProposalsListResponseSchema,
} from "../assets/shared/schemas/group-vote-proposals";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import type { DatabaseLike } from "../functions/_lib/types";
import { activeGroupMembershipAuthorizationEvidence } from "../functions/_lib/services/groups/access";
import {
  approveVoteProposal,
  buildGroupVoteProposalsPageQuery,
  buildGroupVotesPageQuery,
  closeDueVotes,
  computeMotionResult,
  createVoteDirect,
  endorseVoteProposal,
  getVoteProposalDetailForMember,
  getVoteResultsForMember,
  listMyVoteHistory,
  listBallotsForManager,
  listVisibleVotesForMember,
  listVoteProposals,
  rejectVoteProposal,
  submitBallot,
  submitVoteProposal,
  tallyElectionRound,
  transitionManagedVote,
  updateVoteVisibility,
  updateVoteSettings,
} from "../functions/_lib/services/votes";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { gateNextBatch, gateNextRun } from "./helpers/d1-batch-gate";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  authorizedRequest,
  createCanonicalVote,
  createMultiOrganizationUser,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(authorizedRequest(token, path, init), env, createExecutionContext());
}

async function callWithDb(db: DatabaseLike, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(authorizedRequest(token, path, init), { ...env, DB: db }, createExecutionContext());
}

async function callAnonymous(path: string): Promise<Response> {
  return app.fetch(new Request(new URL(path, "https://app.test")), env, createExecutionContext());
}

async function assignGroupRole(userId: string, groupId: string, roleId = "role-group_lead"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, ?, 'group', ?, 0, datetime('now'))`,
  )
    .bind(id, userId, roleId, groupId)
    .run();
  return id;
}

describe("canonical group voting", () => {
  let admin: Awaited<ReturnType<typeof seedVotingAdmin>>["admin"];
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 0 WHERE id IN (?, ?, ?)")
      .bind(TEST_GROUPS.allMembers, TEST_GROUPS.pqc, TEST_GROUPS.cm)
      .run();
    ({ admin, adminToken } = await seedVotingAdmin(env.DB));
  });

  it("creates a vote with one canonical owner group and explicit electorate", async () => {
    const response = await call(adminToken, "/api/v1/admin/votes", {
      method: "POST",
      body: JSON.stringify({
        title: "Canonical architecture vote",
        voteType: "motion",
        ownerGroupId: TEST_GROUPS.pqc,
        electorateMode: "per_member",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      vote: { ownerGroupId: string; ownerGroupName: string; electorateMode: string; status: string };
    };
    expect(body.vote).toMatchObject({
      ownerGroupId: TEST_GROUPS.pqc,
      ownerGroupName: "Post-Quantum Cryptography Working Group",
      electorateMode: "per_member",
      status: "open",
    });
  });

  it("lets effective group leadership create only for its managed group", async () => {
    const leaderId = await insertUser(env.DB, "vote-leader@example.test");
    await assignGroupRole(leaderId, TEST_GROUPS.pqc);
    const leaderToken = await createAdminSession(env.DB, leaderId, "vote-leader-session");
    const body = {
      title: "Leadership vote",
      voteType: "motion",
      electorateMode: "per_person",
      thresholdType: "simple_majority",
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(
      (
        await call(leaderToken, "/api/v1/admin/votes", {
          method: "POST",
          body: JSON.stringify({ ...body, ownerGroupId: TEST_GROUPS.pqc }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(leaderToken, "/api/v1/admin/votes", {
          method: "POST",
          body: JSON.stringify({ ...body, title: "Wrong group", ownerGroupId: TEST_GROUPS.cm }),
        })
      ).status,
    ).toBe(403);
  });

  it("uses the selected group as the immutable vote-management boundary", async () => {
    const leaderId = await insertUser(env.DB, "selected-group-vote-manager@example.test");
    await assignGroupRole(leaderId, TEST_GROUPS.pqc);
    await assignGroupRole(leaderId, TEST_GROUPS.cm);
    const leader = {
      identityType: "user" as const,
      id: leaderId,
      email: "selected-group-vote-manager@example.test",
      role: "user",
    };
    const leaderToken = await createAdminSession(env.DB, leaderId, `selected-vote-manager-${crypto.randomUUID()}`);
    const createdResponse = await call(leaderToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes`, {
      method: "POST",
      body: JSON.stringify({
        title: "Selected-group managed vote",
        voteType: "motion",
        ownerGroupId: TEST_GROUPS.cm,
        electorateMode: "per_member",
        thresholdType: "simple_majority",
        closesAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(200);
    const created = groupVoteMutationResponseSchema.parse(await createdResponse.json()).vote;
    expect(created.ownerGroupId).toBe(TEST_GROUPS.pqc);

    await expect(
      updateVoteSettings(env.DB, leader, created.id, { title: "Wrong context" }, TEST_GROUPS.cm),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED");
    expect(
      (
        await call(leaderToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${created.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "Still wrong context" }),
        })
      ).status,
    ).toBe(403);

    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
    )
      .bind(created.id, TEST_GROUPS.cm)
      .run();
    const updatedResponse = await call(leaderToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Managed through explicit sharing" }),
    });
    expect(updatedResponse.status, await updatedResponse.clone().text()).toBe(200);
    expect(groupVoteMutationResponseSchema.parse(await updatedResponse.json()).vote.title).toBe(
      "Managed through explicit sharing",
    );

    const participant = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, participant.userId, [participant.memberId]);
    const memberToken = await createMemberSession(
      env.DB,
      participant.userId,
      `selected-vote-member-${crypto.randomUUID()}`,
    );
    expect(
      (
        await call(memberToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${created.id}/visibility`, {
          method: "PATCH",
          body: JSON.stringify({ visibility: "public" }),
        })
      ).status,
    ).toBe(403);
  });

  it("keeps identifiable ballots behind exact selected-group management", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Audited group vote" });
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, capacity.userId),
      vote.id,
      capacity.memberId,
      "in_favor",
      null,
    );

    const response = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/ballots?limit=1`);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(groupVoteBallotsAuditResponseSchema.parse(await response.json())).toMatchObject({
      ballots: [{ userId: capacity.userId, memberId: capacity.memberId, choice: "in_favor" }],
      page: { total: 1, hasMore: false },
    });
    expect((await call(adminToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/ballots`)).status).toBe(403);

    const managerId = await insertUser(env.DB, "revoked-ballot-auditor@example.test");
    await assignGroupRole(managerId, TEST_GROUPS.cm);
    const manager = {
      identityType: "user" as const,
      id: managerId,
      email: "revoked-ballot-auditor@example.test",
      role: "user",
    };
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const gate = gateNextBatch(env.DB);
    const pending = listBallotsForManager(gate.db, manager, vote.id, { limit: 20, offset: 0 }, TEST_GROUPS.cm);
    await gate.reached;
    await env.DB.prepare("DELETE FROM vote_group_grants WHERE vote_id = ? AND group_id = ? AND capability = 'manage'")
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
  });

  it("correlates a live manage grant with authority over that same grantee group", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Correlated management vote" });
    const managerId = await insertUser(env.DB, "correlated-vote-manager@example.test");
    await assignGroupRole(managerId, TEST_GROUPS.cm);
    const actor = {
      identityType: "user" as const,
      id: managerId,
      email: "correlated-vote-manager@example.test",
      role: "user",
    };
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
      ).bind(vote.id, TEST_GROUPS.cm),
      env.DB.prepare(
        "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
      ).bind(vote.id, TEST_GROUPS.allMembers),
    ]);

    const gate = gateNextBatch(env.DB);
    const pending = updateVoteVisibility(gate.db, actor, vote.id, { visibility: "public" });
    await gate.reached;
    await env.DB.prepare("DELETE FROM vote_group_grants WHERE vote_id = ? AND group_id = ? AND capability = 'manage'")
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    gate.release();

    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT visibility FROM votes WHERE id = ?", vote.id)).toEqual([
      { visibility: "private" },
    ]);
  });

  it("rechecks vote creation permission inside the D1 batch", async () => {
    const leaderId = await insertUser(env.DB, "revoked-vote-leader@example.test");
    const roleId = await assignGroupRole(leaderId, TEST_GROUPS.pqc);
    const actor = {
      identityType: "user" as const,
      id: leaderId,
      email: "revoked-vote-leader@example.test",
      role: "user",
    };
    const gate = gateNextBatch(env.DB);
    const pending = createVoteDirect(gate.db, actor, {
      title: "Must roll back after revocation",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
      electorateMode: "per_person",
      thresholdType: "simple_majority",
      closesAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_CREATE_AUTHORIZATION_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT id FROM votes WHERE title = 'Must roll back after revocation'")).toHaveLength(
      0,
    );
  });

  it("rolls back the whole aggregate when a candidate insert fails", async () => {
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_vote_candidate BEFORE INSERT ON vote_candidates
       BEGIN SELECT RAISE(ABORT, 'candidate rejected by test'); END`,
    ).run();
    await expect(
      createCanonicalVote(env.DB, admin, {
        title: "Atomic election",
        voteType: "election",
        thresholdType: "simple_majority",
        candidates: [{ name: "Alice" }, { name: "Bob" }],
      }),
    ).rejects.toThrow("candidate rejected by test");
    expect(await queryAll(env.DB, "SELECT id FROM votes WHERE title = 'Atomic election'")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM vote_candidates")).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER test_reject_vote_candidate").run();
  });

  it("keeps separate ballots for every represented Member and lets any current representative update one", async () => {
    const capacityA = await createOrganizationCapacity(env.DB, { organizationName: "Organization A" });
    const capacityB = await createOrganizationCapacity(env.DB, {
      userId: capacityA.userId,
      category: "B",
      organizationName: "Organization B",
    });
    const secondRepresentativeId = await insertUser(env.DB, "second-representative@example.test");
    await addRepresentative(env.DB, capacityA.memberId, secondRepresentativeId);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacityA.userId, [capacityA.memberId, capacityB.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, secondRepresentativeId, [capacityA.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const firstRepresentative = await resolveAuthMember(env.DB, capacityA.userId);
    const secondRepresentative = await resolveAuthMember(env.DB, secondRepresentativeId);

    await submitBallot(env.DB, firstRepresentative, vote.id, capacityA.memberId, "in_favor", null);
    await submitBallot(env.DB, firstRepresentative, vote.id, capacityB.memberId, "opposed", null);
    await submitBallot(env.DB, secondRepresentative, vote.id, capacityA.memberId, "abstain", null);

    expect(
      await queryAll<{ member_id: string; user_id: string; choice: string }>(
        env.DB,
        "SELECT member_id, user_id, choice FROM vote_ballots WHERE vote_id = ? ORDER BY member_id",
        vote.id,
      ),
    ).toEqual(
      [
        { member_id: capacityA.memberId, user_id: secondRepresentativeId, choice: "abstain" },
        { member_id: capacityB.memberId, user_id: capacityA.userId, choice: "opposed" },
      ].sort((left, right) => left.member_id.localeCompare(right.member_id)),
    );
  });

  it("rejects selecting a Member that the caller cannot represent in a participating group", async () => {
    const eligible = await createOrganizationCapacity(env.DB);
    const other = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, eligible.userId, [eligible.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const member = await resolveAuthMember(env.DB, eligible.userId);
    await expect(submitBallot(env.DB, member, vote.id, other.memberId, "in_favor", null)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "MEMBER_BALLOT_NOT_AUTHORIZED",
    );
  });

  it("rechecks representative and group capacity state in the ballot UPSERT", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const member = await resolveAuthMember(env.DB, capacity.userId);
    const gate = gateNextRun(env.DB);
    const pending = submitBallot(gate.db, member, vote.id, capacity.memberId, "in_favor", null);
    await gate.reached;
    const revokedAt = new Date(Date.now() + 1_000).toISOString();
    await env.DB.prepare(
      `UPDATE organization_representatives
       SET left_at = ?, blocked_at = ?
       WHERE member_id = ? AND user_id = ?`,
    )
      .bind(revokedAt, revokedAt, capacity.memberId, capacity.userId)
      .run();
    gate.release();
    await expect(pending).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "VOTE_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM vote_ballots WHERE vote_id = ?", vote.id)).toHaveLength(0);
  });

  it("does not let retained membership rows confer vote access through an inactive owner group", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { title: "Inactive owner vote" });
    const member = await resolveAuthMember(env.DB, capacity.userId);

    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    expect((await listVisibleVotesForMember(env.DB, member, { limit: 20, offset: 0 })).votes).toHaveLength(0);
    await expect(submitBallot(env.DB, member, vote.id, capacity.memberId, "in_favor", null)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "MEMBER_BALLOT_NOT_AUTHORIZED",
    );

    await env.DB.prepare("UPDATE groups SET active = 1 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const gate = gateNextRun(env.DB);
    const pending = submitBallot(gate.db, member, vote.id, capacity.memberId, "in_favor", null);
    await gate.reached;
    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    gate.release();
    await expect(pending).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "VOTE_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM vote_ballots WHERE vote_id = ?", vote.id)).toHaveLength(0);
    await env.DB.prepare("UPDATE groups SET active = 1 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
  });

  it("stores and updates exactly one ballot per person across multiple represented Members", async () => {
    const capacityA = await createOrganizationCapacity(env.DB);
    const capacityB = await createOrganizationCapacity(env.DB, { userId: capacityA.userId, category: "B" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacityA.userId, [capacityA.memberId, capacityB.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { electorateMode: "per_person" });
    const member = await resolveAuthMember(env.DB, capacityA.userId);
    await submitBallot(env.DB, member, vote.id, null, "in_favor", null);
    await submitBallot(env.DB, member, vote.id, undefined, "opposed", null);
    expect(await queryAll(env.DB, "SELECT member_id, choice FROM vote_ballots WHERE vote_id = ?", vote.id)).toEqual([
      { member_id: null, choice: "opposed" },
    ]);
    await expect(submitBallot(env.DB, member, vote.id, capacityA.memberId, "abstain", null)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "MEMBER_ID_NOT_ALLOWED",
    );
  });

  it("uses all active group capacities rather than the session's first membership for proposals", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const multiOrganization = await createMultiOrganizationUser(env.DB);
    const endorser = await createOrganizationCapacity(env.DB);
    const outsider = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, multiOrganization.userId, [multiOrganization.groupMemberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, endorser.userId, [endorser.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, outsider.userId, [outsider.memberId]);
    const proposerMember = await resolveAuthMember(env.DB, multiOrganization.userId);
    expect(proposerMember.memberId).toBe(multiOrganization.defaultMemberId);
    const proposal = await submitVoteProposal(env.DB, proposerMember, {
      title: "Multi-capacity proposal",
      description: "The active group capacity differs from the default represented organization in the session.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });
    expect(
      (await listVoteProposals(env.DB, multiOrganization.userId, { limit: 20, offset: 0 })).proposals,
    ).toHaveLength(1);
    expect((await listVoteProposals(env.DB, outsider.userId, { limit: 20, offset: 0 })).proposals).toHaveLength(0);
    await expect(getVoteProposalDetailForMember(env.DB, proposal.id, outsider.userId)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.status === 404,
    );

    await endorseVoteProposal(env.DB, proposerMember, proposal.id);
    const converted = await endorseVoteProposal(env.DB, await resolveAuthMember(env.DB, endorser.userId), proposal.id);
    expect(converted.convertedVote).toMatchObject({
      ownerGroupId: TEST_GROUPS.pqc,
      electorateMode: "per_member",
    });
  });

  it("rejects proposal configurations that cannot produce a valid vote", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const member = await resolveAuthMember(env.DB, proposer.userId);
    const opensAt = new Date(Date.now() + 120_000).toISOString();
    const closesAt = new Date(Date.now() + 60_000).toISOString();

    await expect(
      submitVoteProposal(env.DB, member, {
        title: "Election without candidates",
        description: "Proposal elections cannot be converted until candidates are represented in the proposal.",
        voteType: "election",
        ownerGroupId: TEST_GROUPS.pqc,
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "ELECTION_PROPOSAL_UNSUPPORTED");
    await expect(
      submitVoteProposal(env.DB, member, {
        title: "Invalid window",
        description: "Closing before opening must not reach storage.",
        voteType: "motion",
        ownerGroupId: TEST_GROUPS.pqc,
        proposedOpensAt: opensAt,
        proposedClosesAt: closesAt,
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "INVALID_WINDOW");
    expect(
      await queryAll(env.DB, "SELECT id FROM vote_proposals WHERE title IN (?, ?)", [
        "Election without candidates",
        "Invalid window",
      ]),
    ).toHaveLength(0);
  });

  it("revalidates a proposal window before conversion", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const proposal = await submitVoteProposal(env.DB, await resolveAuthMember(env.DB, proposer.userId), {
      title: "Window changed before approval",
      description: "Stored proposal data is validated again at the conversion boundary.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
      proposedOpensAt: new Date(Date.now() + 60_000).toISOString(),
      proposedClosesAt: new Date(Date.now() + 120_000).toISOString(),
    });
    await env.DB.prepare("UPDATE vote_proposals SET proposed_closes_at = proposed_opens_at WHERE id = ?")
      .bind(proposal.id)
      .run();

    await expect(approveVoteProposal(env.DB, admin, proposal.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "INVALID_WINDOW",
    );
    expect(await queryAll(env.DB, "SELECT status, vote_id FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "open_for_endorsement", vote_id: null },
    ]);
  });

  it("binds proposal submission, discovery, detail, and endorsement to the selected group", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id IN (?, ?)")
      .bind(TEST_GROUPS.pqc, TEST_GROUPS.cm)
      .run();
    const proposer = await createOrganizationCapacity(env.DB);
    const endorser = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, proposer.userId, [proposer.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, endorser.userId, [endorser.memberId]);
    const proposerToken = await createMemberSession(env.DB, proposer.userId, `group-proposer-${crypto.randomUUID()}`);
    const endorserToken = await createMemberSession(env.DB, endorser.userId, `group-endorser-${crypto.randomUUID()}`);
    const proposedOpensAt = new Date(Date.now() + 60_000).toISOString();
    const proposedClosesAt = new Date(Date.now() + 120_000).toISOString();

    const createResponse = await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Selected-group proposal",
        description: "The path, rather than a caller-supplied owner, defines the proposal boundary.",
        voteType: "motion",
        ownerGroupId: TEST_GROUPS.cm,
        eligibleCategories: ["A", "B"],
        proposedOpensAt,
        proposedClosesAt,
      }),
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(200);
    const created = groupVoteProposalCreateResponseSchema.parse(await createResponse.json()).proposal;
    expect(created).toMatchObject({
      ownerGroupId: TEST_GROUPS.pqc,
      eligibleCategories: ["A", "B"],
      proposedOpensAt,
      proposedClosesAt,
      capabilities: expect.arrayContaining(["view", "endorse", "withdraw"]),
    });

    const listResponse = await call(
      proposerToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals?q=Selected&sort=title&limit=1`,
    );
    expect(listResponse.status, await listResponse.clone().text()).toBe(200);
    expect(groupVoteProposalsListResponseSchema.parse(await listResponse.json())).toMatchObject({
      proposals: [{ id: created.id, ownerGroupId: TEST_GROUPS.pqc }],
      page: { total: 1, hasMore: false },
    });
    expect(
      groupVoteProposalsListResponseSchema.parse(
        await (await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.cm}/vote-proposals`)).json(),
      ).proposals,
    ).toHaveLength(0);
    expect((await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.cm}/vote-proposals/${created.id}`)).status).toBe(
      404,
    );
    const detailResponse = await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${created.id}`);
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(200);
    expect(groupVoteProposalDetailResponseSchema.parse(await detailResponse.json())).toMatchObject({
      proposal: { id: created.id, capabilities: expect.arrayContaining(["view", "endorse", "withdraw"]) },
      endorserUserIds: [],
    });

    const ownEndorsement = await call(
      proposerToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${created.id}/endorsement`,
      { method: "POST" },
    );
    expect(ownEndorsement.status, await ownEndorsement.clone().text()).toBe(200);
    expect(groupVoteProposalEndorseResponseSchema.parse(await ownEndorsement.json()).proposal.capabilities).toContain(
      "withdraw_endorsement",
    );
    const conversion = await call(
      endorserToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${created.id}/endorsement`,
      { method: "POST" },
    );
    expect(conversion.status, await conversion.clone().text()).toBe(200);
    const converted = groupVoteProposalEndorseResponseSchema.parse(await conversion.json());
    expect(converted.convertedVote).toMatchObject({ ownerGroupId: TEST_GROUPS.pqc, voteType: "motion" });
    expect(converted.proposal).toMatchObject({ status: "converted_to_vote", capabilities: ["view"] });
  });

  it("supports withdrawing an endorsement and then the proposal through mounted group routes", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 3 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    const otherMember = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, otherMember.userId, [otherMember.memberId]);
    const proposerToken = await createMemberSession(
      env.DB,
      proposer.userId,
      `withdraw-proposer-${crypto.randomUUID()}`,
    );
    const otherToken = await createMemberSession(env.DB, otherMember.userId, `withdraw-other-${crypto.randomUUID()}`);
    const createResponse = await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Withdraw through selected group",
        description: "Mounted mutation routes preserve the proposal owner boundary.",
        voteType: "motion",
      }),
    });
    const proposal = groupVoteProposalCreateResponseSchema.parse(await createResponse.json()).proposal;

    expect(
      (
        await call(proposerToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}/endorsement`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const withdrawEndorsement = await call(
      proposerToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}/endorsement`,
      { method: "DELETE" },
    );
    expect(withdrawEndorsement.status, await withdrawEndorsement.clone().text()).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT endorser_user_id FROM vote_proposal_endorsements WHERE proposal_id = ?",
        proposal.id,
      ),
    ).toHaveLength(0);

    expect(
      (
        await call(otherToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    const withdrawProposal = await call(
      proposerToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}`,
      { method: "DELETE" },
    );
    expect(withdrawProposal.status, await withdrawProposal.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT status FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "withdrawn" },
    ]);
  });

  it("rejects endorsement withdrawal when voter eligibility is revoked before commit", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 3 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const token = await createMemberSession(
      env.DB,
      proposer.userId,
      `withdraw-endorsement-race-${crypto.randomUUID()}`,
    );
    const createResponse = await call(token, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Endorsement withdrawal authorization race",
        description: "Eligibility must still hold when the withdrawal commits.",
        voteType: "motion",
      }),
    });
    const proposal = groupVoteProposalCreateResponseSchema.parse(await createResponse.json()).proposal;
    const endorsementPath = `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}/endorsement`;
    expect((await call(token, endorsementPath, { method: "POST" })).status).toBe(200);

    const auditBefore = await queryAll<{ count: number }>(
      env.DB,
      "SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'vote_proposal' AND entity_id = ?",
      proposal.id,
    );
    const outboxBefore = await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox");
    const gate = gateNextBatch(env.DB);
    const pending = callWithDb(gate.db, token, endorsementPath, { method: "DELETE" });
    await gate.reached;
    await env.DB.prepare(
      "UPDATE group_memberships SET left_at = '2099-01-01T00:00:00.000Z' WHERE group_id = ? AND user_id = ?",
    )
      .bind(TEST_GROUPS.pqc, proposer.userId)
      .run();
    gate.release();

    const response = await pending;
    expect(response.status, await response.clone().text()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEMBERSHIP_CHANGED" } });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ? AND endorser_user_id = ?",
        [proposal.id, proposer.userId],
      ),
    ).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT status FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "open_for_endorsement" },
    ]);
    expect(
      await queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'vote_proposal' AND entity_id = ?",
        proposal.id,
      ),
    ).toEqual(auditBefore);
    expect(await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox")).toEqual(
      outboxBefore,
    );
  });

  it("rejects proposal withdrawal when voter eligibility is revoked before commit", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 3 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const token = await createMemberSession(env.DB, proposer.userId, `withdraw-proposal-race-${crypto.randomUUID()}`);
    const createResponse = await call(token, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Proposal withdrawal authorization race",
        description: "Eligibility must still hold when the withdrawal commits.",
        voteType: "motion",
      }),
    });
    const proposal = groupVoteProposalCreateResponseSchema.parse(await createResponse.json()).proposal;

    const auditBefore = await queryAll<{ count: number }>(
      env.DB,
      "SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'vote_proposal' AND entity_id = ?",
      proposal.id,
    );
    const outboxBefore = await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox");
    const path = `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}`;
    const gate = gateNextBatch(env.DB);
    const pending = callWithDb(gate.db, token, path, { method: "DELETE" });
    await gate.reached;
    await env.DB.prepare(
      "UPDATE group_memberships SET left_at = '2099-01-01T00:00:00.000Z' WHERE group_id = ? AND user_id = ?",
    )
      .bind(TEST_GROUPS.pqc, proposer.userId)
      .run();
    gate.release();

    const response = await pending;
    expect(response.status, await response.clone().text()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEMBERSHIP_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT status FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "open_for_endorsement" },
    ]);
    expect(
      await queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'vote_proposal' AND entity_id = ?",
        proposal.id,
      ),
    ).toEqual(auditBefore);
    expect(await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox")).toEqual(
      outboxBefore,
    );
  });

  it("retracts proposal discovery when the owning group becomes inactive", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const member = await resolveAuthMember(env.DB, proposer.userId);
    const proposal = await submitVoteProposal(env.DB, member, {
      title: "Inactive owner group",
      description: "Visibility follows the current state of the owning group.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });

    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    expect((await listVoteProposals(env.DB, proposer.userId, { limit: 20, offset: 0 })).proposals).toHaveLength(0);
    await expect(getVoteProposalDetailForMember(env.DB, proposal.id, proposer.userId)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.status === 404,
    );
    await env.DB.prepare("UPDATE groups SET active = 1 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
  });

  it("keeps selected-group proposal decisions manager-only and context-bound", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const member = await resolveAuthMember(env.DB, proposer.userId);
    const memberToken = await createMemberSession(env.DB, proposer.userId, `decision-member-${crypto.randomUUID()}`);
    const proposal = await submitVoteProposal(env.DB, member, {
      title: "Approve through exact group",
      description: "A management decision must be bound to the proposal owner selected in the route.",
      voteType: "consultation",
      ownerGroupId: TEST_GROUPS.pqc,
    });

    expect(
      (
        await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}/approve`, {
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(adminToken, `/api/v1/groups/${TEST_GROUPS.cm}/vote-proposals/${proposal.id}/approve`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    const approveResponse = await call(
      adminToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${proposal.id}/approve`,
      { method: "POST" },
    );
    expect(approveResponse.status, await approveResponse.clone().text()).toBe(200);
    expect(groupVoteProposalApproveResponseSchema.parse(await approveResponse.json())).toMatchObject({
      proposal: { id: proposal.id, status: "converted_to_vote", capabilities: ["view"] },
      convertedVote: { ownerGroupId: TEST_GROUPS.pqc },
    });

    const rejectedProposal = await submitVoteProposal(env.DB, member, {
      title: "Reject through exact group",
      description: "Managers can reject through the owning group without a duplicate admin policy implementation.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });
    const rejectResponse = await call(
      adminToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals/${rejectedProposal.id}/reject`,
      { method: "POST", body: JSON.stringify({ reason: "Needs more discussion" }) },
    );
    expect(rejectResponse.status, await rejectResponse.clone().text()).toBe(200);
    expect(groupVoteProposalRejectResponseSchema.parse(await rejectResponse.json()).proposal).toMatchObject({
      status: "rejected",
      rejectionReason: "Needs more discussion",
      capabilities: ["view"],
    });
    const managerList = groupVoteProposalsListResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals?status=rejected&limit=1`)).json(),
    );
    expect(managerList).toMatchObject({ proposals: [{ id: rejectedProposal.id }], page: { total: 1 } });
    const memberList = groupVoteProposalsListResponseSchema.parse(
      await (
        await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals?status=rejected&limit=1`)
      ).json(),
    );
    expect(memberList).toMatchObject({ proposals: [], page: { total: 0 } });
  });

  it("rejects invalid selected-group proposal contracts before persistence", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const token = await createMemberSession(env.DB, proposer.userId, `invalid-proposal-${crypto.randomUUID()}`);
    const invalidElection = await call(token, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Unsupported election",
        description: "Candidates are not part of the proposal contract yet.",
        voteType: "election",
      }),
    });
    expect(invalidElection.status).toBe(400);
    const invalidWindow = await call(token, `/api/v1/groups/${TEST_GROUPS.pqc}/vote-proposals`, {
      method: "POST",
      body: JSON.stringify({
        title: "Invalid proposed window",
        description: "The shared schema rejects the same invariant as the service.",
        voteType: "motion",
        proposedOpensAt: new Date(Date.now() + 120_000).toISOString(),
        proposedClosesAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    expect(invalidWindow.status).toBe(400);
    expect(
      await queryAll(env.DB, "SELECT id FROM vote_proposals WHERE title IN (?, ?)", [
        "Unsupported election",
        "Invalid proposed window",
      ]),
    ).toHaveLength(0);
  });

  it("atomically rechecks group permission for approval and rejection", async () => {
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 2 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    const proposer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    const proposal = await submitVoteProposal(env.DB, await resolveAuthMember(env.DB, proposer.userId), {
      title: "Authorization race proposal",
      description: "Must remain open when leadership is revoked.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });
    const leaderId = await insertUser(env.DB, "proposal-leader@example.test");
    const roleId = await assignGroupRole(leaderId, TEST_GROUPS.pqc);
    const leader = {
      identityType: "user" as const,
      id: leaderId,
      email: "proposal-leader@example.test",
      role: "user",
    };
    const gate = gateNextBatch(env.DB);
    const pending = approveVoteProposal(gate.db, leader, proposal.id);
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT status, vote_id FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "open_for_endorsement", vote_id: null },
    ]);

    const rejected = await rejectVoteProposal(env.DB, admin, proposal.id, "Not ready");
    expect(rejected.proposal).toMatchObject({ status: "rejected", rejectionReason: "Not ready" });
  });

  it("does not disclose private results through a view-only group grant", async () => {
    const viewer = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, viewer.userId, [viewer.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const result = {
      thresholdType: "simple_majority" as const,
      counts: { in_favor: 1, opposed: 0, abstain: 0 },
      totalBallots: 1,
      outcome: "passed" as const,
    };
    await env.DB.prepare("UPDATE votes SET status = 'closed', result_json = ? WHERE id = ?")
      .bind(JSON.stringify(result), vote.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'view', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const member = await resolveAuthMember(env.DB, viewer.userId);
    const listed = await listVisibleVotesForMember(env.DB, member, { limit: 20, offset: 0 });
    expect(listed.votes).toHaveLength(1);
    expect(listed.votes[0].result).toBeNull();
    await expect(getVoteResultsForMember(env.DB, member, vote.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.status === 404,
    );

    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'view_results', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    expect(await getVoteResultsForMember(env.DB, member, vote.id)).toEqual(result);
  });

  it("applies public result redaction and backend pagination", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Public result" });
    await env.DB.prepare(
      `UPDATE votes
       SET status = 'closed', visibility = 'public', public_detail_level = 'outcome_only',
           result_json = '{"thresholdType":"simple_majority","counts":{"in_favor":2,"opposed":0,"abstain":0},"totalBallots":2,"outcome":"passed"}'
       WHERE id = ?`,
    )
      .bind(vote.id)
      .run();
    const response = await callAnonymous("/api/v1/votes?limit=1&offset=0&status=closed");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { votes: Array<{ ownerGroupId: string; result: unknown }>; page: unknown };
    expect(body.votes).toEqual([
      expect.objectContaining({ ownerGroupId: TEST_GROUPS.pqc, result: { outcome: "passed" } }),
    ]);
    expect(body.page).toMatchObject({ limit: 1, offset: 0, total: 1, hasMore: false });
  });

  it("lists one selected group's votes for participants and staff-only managers", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Selected group vote" });
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const memberToken = await createMemberSession(env.DB, capacity.userId, `group-votes-${crypto.randomUUID()}`);

    const participantResponse = await call(
      memberToken,
      `/api/v1/groups/${TEST_GROUPS.pqc}/votes?q=Selected&sort=title&limit=1`,
    );
    expect(participantResponse.status, await participantResponse.clone().text()).toBe(200);
    const participant = groupVotesListResponseSchema.parse(await participantResponse.json());
    expect(participant).toMatchObject({
      votes: [{ id: vote.id, capabilities: expect.arrayContaining(["view", "participate"]) }],
      page: { total: 1, hasMore: false },
    });
    expect(participant.votes[0].capabilities).not.toContain("view_results");

    const managerResponse = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes?limit=1`);
    expect(managerResponse.status, await managerResponse.clone().text()).toBe(200);
    const manager = groupVotesListResponseSchema.parse(await managerResponse.json());
    expect(manager.votes[0]).toMatchObject({ id: vote.id, capabilities: expect.arrayContaining(["view", "manage"]) });
    expect(manager.votes[0].capabilities).not.toContain("participate");
  });

  it("opens and cancels a vote through an exact group while retracting stale actions", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const memberToken = await createMemberSession(env.DB, capacity.userId, `lifecycle-member-${crypto.randomUUID()}`);
    const vote = await createCanonicalVote(env.DB, admin, {
      title: "Managed lifecycle vote",
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 120_000).toISOString(),
    });

    const scheduledManagerDetail = groupVoteDetailResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`)).json(),
    ).vote;
    expect(scheduledManagerDetail).toMatchObject({
      status: "scheduled",
      availableTransitions: ["open", "cancel"],
    });
    const scheduledMemberDetail = groupVoteDetailResponseSchema.parse(
      await (await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`)).json(),
    ).vote;
    expect(scheduledMemberDetail.capabilities).not.toContain("participate");
    expect(scheduledMemberDetail.availableTransitions).toEqual([]);

    expect(
      (
        await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ transition: "open" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(adminToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ transition: "open" }),
        })
      ).status,
    ).toBe(403);

    const openResponse = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: "open" }),
    });
    expect(openResponse.status, await openResponse.clone().text()).toBe(200);
    expect(groupVoteLifecycleTransitionResponseSchema.parse(await openResponse.json())).toMatchObject({
      outcome: "opened",
      vote: { id: vote.id, status: "open" },
    });
    const openMemberDetail = groupVoteDetailResponseSchema.parse(
      await (await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`)).json(),
    ).vote;
    expect(openMemberDetail.capabilities).toContain("participate");
    expect(openMemberDetail.capabilities).not.toContain("view_results");

    const cancelResponse = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: "cancel", reason: "The question was withdrawn" }),
    });
    expect(cancelResponse.status, await cancelResponse.clone().text()).toBe(200);
    expect(groupVoteLifecycleTransitionResponseSchema.parse(await cancelResponse.json())).toMatchObject({
      outcome: "cancelled",
      vote: { id: vote.id, status: "cancelled", cancellationReason: "The question was withdrawn" },
    });
    const cancelledMemberDetail = groupVoteDetailResponseSchema.parse(
      await (await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`)).json(),
    ).vote;
    expect(cancelledMemberDetail.capabilities).toEqual(["view"]);
    expect(cancelledMemberDetail.availableTransitions).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_representative_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(0);
  });

  it("closes and tallies an open vote through the selected group", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const memberToken = await createMemberSession(env.DB, capacity.userId, `manual-close-${crypto.randomUUID()}`);
    const vote = await createCanonicalVote(env.DB, admin, { title: "Manual close vote" });
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, capacity.userId),
      vote.id,
      capacity.memberId,
      "in_favor",
      null,
      TEST_GROUPS.pqc,
    );

    const closeResponse = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ transition: "close" }),
    });
    expect(closeResponse.status, await closeResponse.clone().text()).toBe(200);
    expect(groupVoteLifecycleTransitionResponseSchema.parse(await closeResponse.json())).toMatchObject({
      outcome: "closed",
      vote: { id: vote.id, status: "closed" },
    });
    const detail = groupVoteDetailResponseSchema.parse(
      await (await call(memberToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}`)).json(),
    ).vote;
    expect(detail.capabilities).toContain("view_results");
    expect(detail.capabilities).not.toContain("participate");
    expect(detail.result).toMatchObject({ outcome: "passed", totalBallots: 1 });
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'vote_%' ORDER BY created_at, id",
        vote.id,
      ),
    ).toEqual(expect.arrayContaining([{ action: "vote_close_requested" }, { action: "vote_closed_manually" }]));
  });

  it("releases a manual close claim when finalization fails", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Recoverable manual close" });
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_manual_vote_close_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'vote_closed_manually'
       BEGIN SELECT RAISE(ABORT, 'manual close audit rejected by test'); END`,
    ).run();

    await expect(
      transitionManagedVote(env.DB, admin, vote.id, { transition: "close" }, TEST_GROUPS.pqc),
    ).rejects.toThrow("manual close audit rejected by test");
    expect(
      await queryAll(env.DB, "SELECT status, transition_processing_token FROM votes WHERE id = ?", vote.id),
    ).toEqual([{ status: "open", transition_processing_token: null }]);
    await env.DB.prepare("DROP TRIGGER test_reject_manual_vote_close_audit").run();
  });

  it("atomically rejects a managed lifecycle transition after leadership revocation", async () => {
    const vote = await createCanonicalVote(env.DB, admin, {
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const leaderId = await insertUser(env.DB, "transition-leader@example.test");
    const roleId = await assignGroupRole(leaderId, TEST_GROUPS.pqc);
    const leader = {
      identityType: "user" as const,
      id: leaderId,
      email: "transition-leader@example.test",
      role: "user",
    };
    const gate = gateNextBatch(env.DB);
    const pending = transitionManagedVote(gate.db, leader, vote.id, { transition: "open" }, TEST_GROUPS.pqc);
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id)).toEqual([{ status: "scheduled" }]);
  });

  it("binds vote detail, ballots, and results to the selected group", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Context-bound vote" });
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, capacity.userId, [capacity.memberId]);
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'view', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const token = await createMemberSession(env.DB, capacity.userId, `group-vote-detail-${crypto.randomUUID()}`);

    const detailResponse = await call(token, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}`);
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(200);
    expect(groupVoteDetailResponseSchema.parse(await detailResponse.json()).vote).toMatchObject({
      id: vote.id,
      capabilities: ["view"],
      canCastBallot: false,
    });
    expect(
      (
        await call(token, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/ballots`, {
          method: "POST",
          body: JSON.stringify({ memberId: capacity.memberId, choice: "in_favor" }),
        })
      ).status,
    ).toBe(403);

    expect(
      (
        await call(token, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/ballots`, {
          method: "POST",
          body: JSON.stringify({ memberId: capacity.memberId, choice: "in_favor" }),
        })
      ).status,
    ).toBe(200);
    expect(await queryAll(env.DB, "SELECT choice FROM vote_ballots WHERE vote_id = ?", vote.id)).toEqual([
      { choice: "in_favor" },
    ]);

    const result = {
      thresholdType: "simple_majority",
      counts: { in_favor: 1, opposed: 0, abstain: 0 },
      totalBallots: 1,
      outcome: "passed",
    };
    await env.DB.prepare("UPDATE votes SET status = 'closed', result_json = ? WHERE id = ?")
      .bind(JSON.stringify(result), vote.id)
      .run();
    expect((await call(token, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/results`)).status).toBe(404);
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'view_results', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const resultsResponse = await call(token, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/results`);
    expect(resultsResponse.status, await resultsResponse.clone().text()).toBe(200);
    expect(groupVoteResultsResponseSchema.parse(await resultsResponse.json()).result).toEqual(result);
  });

  it("does not turn a leadership-only manage grant into member vote access", async () => {
    const vote = await createCanonicalVote(env.DB, admin, { title: "Managed without participation" });
    const result = {
      thresholdType: "simple_majority",
      counts: { in_favor: 0, opposed: 0, abstain: 0 },
      totalBallots: 0,
      outcome: "failed",
    };
    await env.DB.prepare("UPDATE votes SET status = 'closed', result_json = ? WHERE id = ?")
      .bind(JSON.stringify(result), vote.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, capacity.userId, [capacity.memberId]);
    const member = await resolveAuthMember(env.DB, capacity.userId);
    const memberToken = await createMemberSession(env.DB, capacity.userId, `manage-only-member-${crypto.randomUUID()}`);
    expect((await listVisibleVotesForMember(env.DB, member, { limit: 20, offset: 0 })).votes).toHaveLength(0);
    expect((await call(memberToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}`)).status).toBe(404);
    await expect(getVoteResultsForMember(env.DB, member, vote.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.status === 404,
    );

    const leaderId = await insertUser(env.DB, "shared-vote-manager@example.test");
    await assignGroupRole(leaderId, TEST_GROUPS.cm);
    const leaderToken = await createAdminSession(env.DB, leaderId, `shared-vote-manager-${crypto.randomUUID()}`);
    const detailResponse = await call(leaderToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}`);
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(200);
    const managedVote = groupVoteDetailResponseSchema.parse(await detailResponse.json()).vote;
    expect(managedVote.capabilities).toEqual(expect.arrayContaining(["view", "view_results", "manage"]));
    expect(managedVote.capabilities).not.toContain("participate");
    expect(managedVote.canCastBallot).toBe(false);
    const resultsResponse = await call(leaderToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/results`);
    expect(groupVoteResultsResponseSchema.parse(await resultsResponse.json()).result).toEqual(result);
  });

  it("records per-Member history and closes a motion from SQL aggregates", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      closesAt: new Date(Date.now() + 100).toISOString(),
    });
    const member = await resolveAuthMember(env.DB, capacity.userId);
    await submitBallot(env.DB, member, vote.id, capacity.memberId, "in_favor", null);
    const history = await listMyVoteHistory(env.DB, member, { limit: 20, offset: 0 });
    expect(history.votes[0]).toMatchObject({ voteId: vote.id, memberId: capacity.memberId, choice: "in_favor" });
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 100).toISOString(), vote.id)
      .run();
    expect((await closeDueVotes(env.DB, 10)).closed).toContain(vote.id);
    const [closed] = await queryAll<{ status: string; result_json: string }>(
      env.DB,
      "SELECT status, result_json FROM votes WHERE id = ?",
      vote.id,
    );
    expect(closed.status).toBe("closed");
    expect(JSON.parse(closed.result_json)).toMatchObject({ outcome: "passed", totalBallots: 1 });
  });

  it("retains threshold and election tally semantics independently of persistence", () => {
    expect(
      computeMotionResult("supermajority", [{ choice: "in_favor" }, { choice: "in_favor" }, { choice: "opposed" }]),
    ).toMatchObject({ outcome: "passed", totalBallots: 3 });
    expect(
      tallyElectionRound(1, ["a", "b", "c"], [{ choice: "a" }, { choice: "a" }, { choice: "b" }, { choice: "c" }]),
    ).toEqual({
      round: 1,
      counts: { a: 2, b: 1, c: 1 },
      eliminatedCandidateIds: ["b", "c"],
      winnerCandidateId: null,
    });
  });

  it("uses indexed plans for group-scoped discovery and Member ballot replacement", async () => {
    const groupVotes = buildOffsetPageSql(
      buildGroupVotesPageQuery(
        TEST_GROUPS.pqc,
        {
          memberEvidence: activeGroupMembershipAuthorizationEvidence(admin.id, TEST_GROUPS.pqc),
          managerEvidence: { sql: "SELECT 1 WHERE 0", bindings: [] },
        },
        { limit: 20, offset: 0 },
      ),
    );
    const groupVotesPlan = await queryAll<{ detail: string }>(env.DB, `EXPLAIN QUERY PLAN ${groupVotes.pageSql}`, [
      ...groupVotes.bindings,
      20,
      0,
    ]);
    expect(groupVotesPlan.map((row) => row.detail).join("\n")).toMatch(/idx_votes_group_status/);
    expect(groupVotesPlan.map((row) => row.detail).join("\n")).toMatch(/idx_vote_group_grants_group/);
    const groupProposals = buildOffsetPageSql(
      buildGroupVoteProposalsPageQuery({ userId: admin.id, admin }, TEST_GROUPS.pqc, {
        limit: 20,
        offset: 0,
        status: "open_for_endorsement",
      }),
    );
    const groupProposalsPlan = await queryAll<{ detail: string }>(
      env.DB,
      `EXPLAIN QUERY PLAN ${groupProposals.pageSql}`,
      [...groupProposals.bindings, 20, 0],
    );
    expect(groupProposalsPlan.map((row) => row.detail).join("\n")).toMatch(
      /idx_vote_proposals_(?:group_status|status_scope_created_at)/,
    );
    expect(groupProposalsPlan.map((row) => row.detail).join("\n")).toMatch(/idx_vote_proposal_endorsements_proposal/);
    const visibilityPlan = await queryAll<{ detail: string }>(
      env.DB,
      `EXPLAIN QUERY PLAN
       SELECT votes.id FROM votes
       WHERE EXISTS (
         SELECT 1 FROM group_memberships membership
         WHERE membership.user_id = ? AND membership.left_at IS NULL
           AND membership.group_id = votes.owner_group_id
       )`,
      admin.id,
    );
    expect(visibilityPlan.map((row) => row.detail).join("\n")).toMatch(/idx_group_memberships_user_active/);
    const ballotPlan = await queryAll<{ detail: string }>(
      env.DB,
      "EXPLAIN QUERY PLAN SELECT id FROM vote_ballots WHERE vote_id = ? AND member_id = ? AND round = ?",
      crypto.randomUUID(),
      crypto.randomUUID(),
      1,
    );
    expect(ballotPlan.map((row) => row.detail).join("\n")).toMatch(/idx_vote_ballots_member_round/);
  });

  it("rechecks vote-management authorization for visibility updates", async () => {
    const vote = await createCanonicalVote(env.DB, admin);
    const managerId = await insertUser(env.DB, "visibility-manager@example.test");
    const roleId = await assignGroupRole(managerId, TEST_GROUPS.pqc);
    const manager = {
      identityType: "user" as const,
      id: managerId,
      email: "visibility-manager@example.test",
      role: "user",
    };
    const gate = gateNextBatch(env.DB);
    const pending = updateVoteVisibility(gate.db, manager, vote.id, { visibility: "public" });
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
    expect(await queryAll(env.DB, "SELECT visibility FROM votes WHERE id = ?", vote.id)).toEqual([
      { visibility: "private" },
    ]);
  });
});
