/**
 * Live category-voting policy must govern every member-driven proposal
 * transition, including the atomic endorsement-to-vote conversion.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isAppError } from "../functions/_lib/errors";
import { endorseVoteProposal, submitVoteProposal } from "../functions/_lib/services/votes";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";

describe("vote-proposal D1 voting-category policy", () => {
  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 1 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
    await seedVotingAdmin(env.DB);
  });

  it("rechecks the policy for submission, endorsement, and its threshold-triggered conversion", async () => {
    const capacity = await createOrganizationCapacity(env.DB, { category: "H1" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const member = await resolveAuthMember(env.DB, capacity.userId);
    const input = {
      title: "Voting-policy proposal",
      description: "The same live D1 category policy must govern every member proposal transition.",
      voteType: "motion" as const,
      ownerGroupId: TEST_GROUPS.pqc,
    };

    await expect(submitVoteProposal(env.DB, member, input)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "NOT_AN_ELIGIBLE_GROUP_VOTER",
    );

    await env.DB.prepare("UPDATE membership_categories SET is_voting = 1 WHERE code = 'H1'").run();
    const proposal = await submitVoteProposal(env.DB, member, input);

    const gate = gateNextBatch(env.DB);
    const pending = endorseVoteProposal(gate.db, member, proposal.id);
    await gate.reached;
    await env.DB.prepare("UPDATE membership_categories SET is_voting = 0 WHERE code = 'H1'").run();
    gate.release();

    await expect(pending).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "MEMBERSHIP_CHANGED",
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ?", proposal.id),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM votes WHERE source_proposal_id = ?", proposal.id)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT status FROM vote_proposals WHERE id = ?", proposal.id)).toEqual([
      { status: "open_for_endorsement" },
    ]);

    await env.DB.prepare("UPDATE membership_categories SET is_voting = 1 WHERE code = 'H1'").run();
    const converted = await endorseVoteProposal(env.DB, member, proposal.id);
    expect(converted).toMatchObject({ proposal: { status: "converted_to_vote" } });
    expect(converted.convertedVote).not.toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM votes WHERE source_proposal_id = ?", proposal.id)).toHaveLength(1);
  });
});
