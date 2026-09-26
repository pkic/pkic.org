import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { groupVoteStatisticsResponseSchema } from "../assets/shared/schemas/group-vote-statistics";
import app from "../functions/router";
import { isAppError } from "../functions/_lib/errors";
import { getVoteStatisticsForManager, submitBallot } from "../functions/_lib/services/votes";
import { VOTE_CURRENT_PARTICIPATION_STATISTICS_QUERY } from "../functions/_lib/services/votes/voter-eligibility";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
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

async function call(token: string, path: string): Promise<Response> {
  return app.fetch(authorizedRequest(token, path), env, createExecutionContext());
}

describe("group vote statistics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("counts Member capacities without exposing live choices", async () => {
    const { admin, adminToken } = await seedVotingAdmin(env.DB);
    const capacity = await createMultiOrganizationUser(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.defaultMemberId, capacity.groupMemberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const member = await resolveAuthMember(env.DB, capacity.userId, crypto.randomUUID(), capacity.groupIdentityId);
    await submitBallot(env.DB, member, vote.id, capacity.groupMemberId, "in_favor", null, TEST_GROUPS.pqc);

    const response = await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`);
    expect(response.status, await response.clone().text()).toBe(200);
    const statistics = groupVoteStatisticsResponseSchema.parse(await response.json());
    expect(statistics.participation).toEqual({
      unit: "member",
      currentEligible: 2,
      currentEligibleCast: 1,
      currentEligibleNotCast: 1,
      effectiveBallots: 1,
      ballotsWithoutCurrentEligibility: 0,
    });
    expect(statistics.aggregate).toEqual({ availability: "withheld_until_closed" });

    await env.DB.prepare("UPDATE votes SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(vote.id)
      .run();
    const closed = groupVoteStatisticsResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).json(),
    );
    expect(closed.aggregate).toEqual({
      availability: "available",
      kind: "motion",
      counts: { in_favor: 1, opposed: 0, abstain: 0 },
    });
  });

  it("distinguishes historical ballots from the currently eligible electorate", async () => {
    const { admin, adminToken } = await seedVotingAdmin(env.DB);
    const first = await createOrganizationCapacity(env.DB);
    const second = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, first.userId, [first.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, second.userId, [second.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, second.userId),
      vote.id,
      second.memberId,
      "opposed",
      null,
      TEST_GROUPS.pqc,
    );
    await env.DB.prepare(
      `UPDATE identities
          SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second'),
              blocked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second')
        WHERE id = ? AND user_id = ?`,
    )
      .bind(second.identityId, second.userId)
      .run();

    const response = groupVoteStatisticsResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).json(),
    );
    expect(response.participation).toMatchObject({
      currentEligible: 1,
      currentEligibleCast: 0,
      effectiveBallots: 1,
      ballotsWithoutCurrentEligibility: 1,
    });
  });

  it("counts one person once when the person represents multiple Members", async () => {
    const { admin, adminToken } = await seedVotingAdmin(env.DB);
    const capacity = await createMultiOrganizationUser(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.defaultMemberId, capacity.groupMemberId]);
    const vote = await createCanonicalVote(env.DB, admin, { electorateMode: "per_person" });
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, capacity.userId, crypto.randomUUID(), capacity.defaultIdentityId),
      vote.id,
      null,
      "abstain",
      null,
      TEST_GROUPS.pqc,
    );

    const response = groupVoteStatisticsResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).json(),
    );
    expect(response.participation).toEqual({
      unit: "person",
      currentEligible: 1,
      currentEligibleCast: 1,
      currentEligibleNotCast: 0,
      effectiveBallots: 1,
      ballotsWithoutCurrentEligibility: 0,
    });
  });

  it("returns bounded current-round candidate counts only after an election closes", async () => {
    const { admin, adminToken } = await seedVotingAdmin(env.DB);
    const first = await createOrganizationCapacity(env.DB);
    const second = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, first.userId, [first.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, second.userId, [second.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      voteType: "election",
      electorateMode: "per_person",
      thresholdType: "simple_majority",
      candidates: [{ name: "Ada" }, { name: "Grace" }],
    });
    const candidates = await queryAll<{ id: string; candidate_name: string }>(
      env.DB,
      "SELECT id, candidate_name FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order ASC",
      vote.id,
    );
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, first.userId),
      vote.id,
      null,
      candidates[0].id,
      null,
      TEST_GROUPS.pqc,
    );
    await submitBallot(
      env.DB,
      await resolveAuthMember(env.DB, second.userId),
      vote.id,
      null,
      candidates[1].id,
      null,
      TEST_GROUPS.pqc,
    );
    await env.DB.prepare("UPDATE votes SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .bind(vote.id)
      .run();

    const response = groupVoteStatisticsResponseSchema.parse(
      await (await call(adminToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).json(),
    );
    expect(response.aggregate).toEqual({
      availability: "available",
      kind: "election",
      candidates: [
        { candidateId: candidates[0].id, candidateName: "Ada", count: 1 },
        { candidateId: candidates[1].id, candidateName: "Grace", count: 1 },
      ],
    });
  });

  it("requires exact group management and rechecks it in the aggregate batch", async () => {
    const { admin } = await seedVotingAdmin(env.DB);
    const vote = await createCanonicalVote(env.DB, admin);
    const participant = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, participant.userId, [participant.memberId]);
    const participantToken = await createMemberSession(env.DB, participant.userId, crypto.randomUUID());
    expect((await call(participantToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).status).toBe(
      403,
    );

    const managerId = await insertUser(env.DB, "vote-statistics-manager@example.test");
    const { roleAssignmentId: roleId, memberId } = await grantGroupLeadershipCapacity(
      env.DB,
      TEST_GROUPS.cm,
      managerId,
    );
    await env.DB.prepare(
      "INSERT INTO vote_group_grants (vote_id, group_id, capability, created_at) VALUES (?, ?, 'manage', datetime('now'))",
    )
      .bind(vote.id, TEST_GROUPS.cm)
      .run();
    const manager = {
      identityType: "user" as const,
      id: managerId,
      email: "vote-statistics-manager@example.test",
      role: "user",
      memberId,
    };
    const managerToken = await createAdminSession(env.DB, managerId, crypto.randomUUID(), undefined, memberId);
    expect((await call(managerToken, `/api/v1/groups/${TEST_GROUPS.cm}/votes/${vote.id}/statistics`)).status).toBe(200);
    expect((await call(managerToken, `/api/v1/groups/${TEST_GROUPS.pqc}/votes/${vote.id}/statistics`)).status).toBe(
      403,
    );

    const gate = gateNextBatch(env.DB);
    const pending = getVoteStatisticsForManager(gate.db, manager, TEST_GROUPS.cm, vote.id);
    await gate.reached;
    await env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE id = ?").bind(roleId).run();
    gate.release();
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "VOTE_MANAGEMENT_CHANGED",
    );
  });

  it("uses vote and ballot indexes for the production aggregate", async () => {
    await seedVotingAdmin(env.DB);
    const plan = await queryAll<{ detail: string }>(
      env.DB,
      `EXPLAIN QUERY PLAN ${VOTE_CURRENT_PARTICIPATION_STATISTICS_QUERY}`,
      crypto.randomUUID(),
    );
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail).toMatch(/sqlite_autoindex_votes_1|SEARCH votes USING INDEX/);
    expect(detail).toMatch(/idx_vote_ballots_vote_round/);
    expect(detail).toMatch(/idx_group_memberships_group_active|idx_group_memberships_user_active/);
  });
});
