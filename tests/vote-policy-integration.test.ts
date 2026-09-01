import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  createCanonicalVote,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";
import { closeDueVotes, submitBallot } from "../functions/_lib/services/votes";
import { queryAll } from "./helpers/context";
import type { AuthAdmin } from "../functions/_lib/types";

/**
 * The turnout floor, the Member exclusion, and the chair's deciding vote are
 * decided by SQL and the close path, not only by the pure tally. These cover
 * the wiring: that the electorate the quorum is measured against is the same
 * one the ballot insert uses, that an excluded Member is refused rather than
 * silently ignored, and that a tie is settled by a real ballot.
 */
async function closedResult(voteId: string) {
  await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
    .bind(new Date(Date.now() - 1_000).toISOString(), voteId)
    .run();
  await closeDueVotes(env.DB);
  const [row] = await queryAll<{ result_json: string | null }>(env.DB, "SELECT result_json FROM votes WHERE id = ?", [
    voteId,
  ]);
  return JSON.parse(row.result_json ?? "null");
}

describe("vote policy against real D1", () => {
  let admin: AuthAdmin;

  beforeEach(async () => {
    await resetDb();
    ({ admin } = await seedVotingAdmin(env.DB));
  });

  it("reports not_quorate when turnout falls below the configured floor", async () => {
    // Three eligible Members, only one votes, and half of them is required.
    const voters = [];
    for (let index = 0; index < 3; index += 1) {
      const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
      await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
      voters.push(capacity);
    }
    const vote = await createCanonicalVote(env.DB, admin, { quorumPercent: 50 });

    const member = await resolveAuthMember(env.DB, voters[0].userId);
    await submitBallot(env.DB, member, vote.id, voters[0].memberId, "in_favor", null);

    const result = await closedResult(vote.id);
    expect(result.outcome).toBe("not_quorate");
    expect(result.quorum).toEqual({ percent: 50, eligible: 3, required: 2, met: false });
  });

  it("passes once turnout reaches the floor", async () => {
    const voters = [];
    for (let index = 0; index < 3; index += 1) {
      const capacity = await createOrganizationCapacity(env.DB, { category: "A" });
      await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
      voters.push(capacity);
    }
    const vote = await createCanonicalVote(env.DB, admin, { quorumPercent: 50 });

    for (const voter of voters.slice(0, 2)) {
      const member = await resolveAuthMember(env.DB, voter.userId);
      await submitBallot(env.DB, member, vote.id, voter.memberId, "in_favor", null);
    }

    const result = await closedResult(vote.id);
    expect(result.quorum.met).toBe(true);
    expect(result.outcome).toBe("passed");
  });

  it("refuses a ballot from an excluded Member and leaves it out of the electorate", async () => {
    const subject = await createOrganizationCapacity(env.DB, { category: "A" });
    const other = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, subject.userId, [subject.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, other.userId, [other.memberId]);

    // The bylaws bar the Member whose withdrawal is the subject of the vote.
    const vote = await createCanonicalVote(env.DB, admin, {
      quorumPercent: 100,
      excludedMemberIds: [subject.memberId],
    });

    const excluded = await resolveAuthMember(env.DB, subject.userId);
    await expect(submitBallot(env.DB, excluded, vote.id, subject.memberId, "in_favor", null)).rejects.toThrow();

    const remaining = await resolveAuthMember(env.DB, other.userId);
    await submitBallot(env.DB, remaining, vote.id, other.memberId, "in_favor", null);

    // A 100% floor is met by the one Member still entitled to vote, which is
    // only true if the excluded Member left the denominator too.
    const result = await closedResult(vote.id);
    expect(result.quorum).toEqual({ percent: 100, eligible: 1, required: 1, met: true });
    expect(result.outcome).toBe("passed");
  });

  it("settles a tie with the chair's own ballot when the vote is configured for it", async () => {
    const chair = await createOrganizationCapacity(env.DB, { category: "A" });
    const opponent = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, chair.userId, [chair.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, opponent.userId, [opponent.memberId]);

    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, identity_id, member_id, role_id, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, 'role-group_lead', 'group', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(crypto.randomUUID(), chair.userId, chair.identityId, chair.memberId, TEST_GROUPS.pqc, chair.userId)
      .run();

    const vote = await createCanonicalVote(env.DB, admin, { tieBreakMode: "chair" });
    const chairMember = await resolveAuthMember(env.DB, chair.userId);
    const opponentMember = await resolveAuthMember(env.DB, opponent.userId);
    await submitBallot(env.DB, chairMember, vote.id, chair.memberId, "in_favor", null);
    await submitBallot(env.DB, opponentMember, vote.id, opponent.memberId, "opposed", null);

    const result = await closedResult(vote.id);
    expect(result.castingVote).toEqual({ role: "lead", choice: "in_favor" });
    expect(result.outcome).toBe("passed");
    // The recorded counts must still reconcile with the ballots actually cast.
    expect(result.counts).toEqual({ in_favor: 1, opposed: 1, abstain: 0 });
  });

  it("leaves a tie unapproved when the vote did not ask for a deciding vote", async () => {
    const chair = await createOrganizationCapacity(env.DB, { category: "A" });
    const opponent = await createOrganizationCapacity(env.DB, { category: "A" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, chair.userId, [chair.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, opponent.userId, [opponent.memberId]);
    await env.DB.prepare(
      `INSERT INTO user_roles
         (id, user_id, identity_id, member_id, role_id, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, 'role-group_lead', 'group', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(crypto.randomUUID(), chair.userId, chair.identityId, chair.memberId, TEST_GROUPS.pqc, chair.userId)
      .run();

    const vote = await createCanonicalVote(env.DB, admin);
    const chairMember = await resolveAuthMember(env.DB, chair.userId);
    const opponentMember = await resolveAuthMember(env.DB, opponent.userId);
    await submitBallot(env.DB, chairMember, vote.id, chair.memberId, "in_favor", null);
    await submitBallot(env.DB, opponentMember, vote.id, opponent.memberId, "opposed", null);

    const result = await closedResult(vote.id);
    expect(result.castingVote).toBeNull();
    expect(result.outcome).toBe("failed");
  });
});
