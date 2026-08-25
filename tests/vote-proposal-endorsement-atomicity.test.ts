import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { isAppError } from "../functions/_lib/errors";
import { endorseVoteProposal, submitVoteProposal } from "../functions/_lib/services/votes";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { TEST_GROUPS, createOrganizationCapacity, joinVotingGroup, resolveAuthMember } from "./helpers/voting";

function dbThrowingOn(failingSql: string, message: string): DatabaseLike {
  const target = failingSql.replace(/\s+/g, " ").trim();
  function wrap(real: StatementLike, sql: string): StatementLike & { raw: StatementLike } {
    const fails = sql.replace(/\s+/g, " ").trim() === target;
    return {
      raw: real,
      bind: (...values) => wrap(real.bind(...values), sql),
      run: async () => {
        if (fails) throw new Error(message);
        return real.run();
      },
      all: async () => {
        if (fails) throw new Error(message);
        return real.all();
      },
      first: async (columnName) => {
        if (fails) throw new Error(message);
        return real.first(columnName);
      },
    };
  }
  return {
    prepare: (sql) => wrap(env.DB.prepare(sql), sql),
    batch: (statements) =>
      env.DB.batch(statements.map((statement) => (statement as StatementLike & { raw: StatementLike }).raw)),
  };
}

describe("vote proposal endorsement atomicity", () => {
  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare("UPDATE groups SET min_endorsers_for_ballot = 5 WHERE id = ?").bind(TEST_GROUPS.pqc).run();
  });

  async function setupProposal() {
    const proposer = await createOrganizationCapacity(env.DB);
    const endorser = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, proposer.userId, [proposer.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, endorser.userId, [endorser.memberId]);
    const proposal = await submitVoteProposal(env.DB, await resolveAuthMember(env.DB, proposer.userId), {
      title: `Atomic proposal ${crypto.randomUUID()}`,
      description: "Below-threshold endorsement must commit without a partial conversion.",
      voteType: "motion",
      ownerGroupId: TEST_GROUPS.pqc,
    });
    return { proposal, endorser };
  }

  it("records a below-threshold endorsement in the same batch as the guarded conversion no-op", async () => {
    const { proposal, endorser } = await setupProposal();
    const result = await endorseVoteProposal(env.DB, await resolveAuthMember(env.DB, endorser.userId), proposal.id);
    expect(result.convertedVote).toBeNull();
    expect(result.proposal.status).toBe("open_for_endorsement");
    expect(
      await queryAll(env.DB, "SELECT id FROM vote_proposal_endorsements WHERE proposal_id = ?", proposal.id),
    ).toHaveLength(1);
  });

  it("adds proposal context when the lost-race state re-read itself fails", async () => {
    const { proposal, endorser } = await setupProposal();
    const failingDb = dbThrowingOn(
      "SELECT vote_id FROM vote_proposals WHERE id = ?",
      "simulated transient D1 state re-read failure",
    );
    await expect(
      endorseVoteProposal(failingDb, await resolveAuthMember(env.DB, endorser.userId), proposal.id),
    ).rejects.toSatisfy((error: unknown) => {
      if (!isAppError(error)) return false;
      expect(error.code).toBe("VOTE_CONVERSION_STATUS_UNKNOWN");
      expect(error.details).toMatchObject({ proposalId: proposal.id });
      return true;
    });
  });
});
