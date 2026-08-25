import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../functions/router";
import { isAppError } from "../functions/_lib/errors";
import {
  approveVoteProposal,
  closeDueVotes,
  computeMotionResult,
  createVoteDirect,
  endorseVoteProposal,
  getVoteProposalDetailForMember,
  getVoteResultsForMember,
  listMyVoteHistory,
  listVisibleVotesForMember,
  listVoteProposals,
  rejectVoteProposal,
  submitBallot,
  submitVoteProposal,
  tallyElectionRound,
  updateVoteVisibility,
} from "../functions/_lib/services/votes";
import { createAdminSession } from "./helpers/auth";
import { gateNextBatch, gateNextRun } from "./helpers/d1-batch-gate";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  authorizedRequest,
  createCanonicalVote,
  createIndividualAndOrganizationUser,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(authorizedRequest(token, path, init), env, createExecutionContext());
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
    const mixed = await createIndividualAndOrganizationUser(env.DB);
    const endorser = await createOrganizationCapacity(env.DB);
    const outsider = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, mixed.userId, [mixed.organizationMemberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, endorser.userId, [endorser.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.cm, outsider.userId, [outsider.memberId]);
    const proposerMember = await resolveAuthMember(env.DB, mixed.userId);
    expect(proposerMember.memberId).toBe(mixed.individualMemberId);
    const proposal = await submitVoteProposal(env.DB, proposerMember, {
      title: "Multi-capacity proposal",
      description: "The active group capacity is organizational even though the default session capacity is not.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });
    expect((await listVoteProposals(env.DB, mixed.userId, { limit: 20, offset: 0 })).proposals).toHaveLength(1);
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
