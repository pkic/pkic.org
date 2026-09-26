import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { closeDueVotes, submitBallot } from "../functions/_lib/services/votes";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import {
  TEST_GROUPS,
  createCanonicalVote,
  createOrganizationCapacity,
  joinVotingGroup,
  resolveAuthMember,
  seedVotingAdmin,
} from "./helpers/voting";

describe("bounded canonical vote lifecycle", () => {
  let admin: Awaited<ReturnType<typeof seedVotingAdmin>>["admin"];

  beforeEach(async () => {
    await resetDb();
    ({ admin } = await seedVotingAdmin(env.DB));
  });

  it("does nothing when no votes are due", async () => {
    expect(await closeDueVotes(env.DB, 10)).toEqual({ opened: [], closed: [], roundsAdvanced: [] });
  });

  it("lets concurrent runners close one vote and write one audit event", async () => {
    const vote = await createCanonicalVote(env.DB, admin);
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    const results = await Promise.all([closeDueVotes(env.DB, 10), closeDueVotes(env.DB, 10)]);
    expect(results.flatMap((result) => result.closed)).toEqual([vote.id]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'vote_closed_automatically'",
        vote.id,
      ),
    ).toHaveLength(1);
  });

  it("keeps a failed finalization leased and recovers after lease expiry", async () => {
    const vote = await createCanonicalVote(env.DB, admin);
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_vote_close_audit
       BEFORE INSERT ON audit_log WHEN NEW.action = 'vote_closed_automatically'
       BEGIN SELECT RAISE(ABORT, 'close audit rejected by test'); END`,
    ).run();
    await expect(closeDueVotes(env.DB, 10)).rejects.toThrow("close audit rejected by test");
    expect(
      await queryAll(
        env.DB,
        "SELECT closed_at, transition_processing_token IS NOT NULL AS leased FROM votes WHERE id = ?",
        vote.id,
      ),
    ).toEqual([{ closed_at: null, leased: 1 }]);
    expect((await closeDueVotes(env.DB, 10)).closed).toEqual([]);

    await env.DB.prepare("DROP TRIGGER test_reject_vote_close_audit").run();
    await env.DB.prepare("UPDATE votes SET transition_lease_expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    expect((await closeDueVotes(env.DB, 10)).closed).toEqual([vote.id]);
  });

  it("advances a successive-elimination election and then closes with a winner", async () => {
    const voters = await Promise.all(
      ["A", "B", "C", "D"].map((category) => createOrganizationCapacity(env.DB, { category })),
    );
    for (const voter of voters) await joinVotingGroup(env.DB, TEST_GROUPS.pqc, voter.userId, [voter.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      voteType: "election",
      electorateMode: "per_person",
      thresholdType: "successive_elimination",
      candidates: [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }],
    });
    const candidates = await queryAll<{ id: string; candidate_name: string }>(
      env.DB,
      "SELECT id, candidate_name FROM vote_candidates WHERE vote_id = ? ORDER BY sort_order",
      vote.id,
    );
    const byName = new Map(candidates.map((candidate) => [candidate.candidate_name, candidate.id]));
    const firstRoundChoices = [byName.get("Alice")!, byName.get("Alice")!, byName.get("Bob")!, byName.get("Carol")!];
    for (const [index, voter] of voters.entries()) {
      await submitBallot(
        env.DB,
        await resolveAuthMember(env.DB, voter.userId),
        vote.id,
        null,
        firstRoundChoices[index],
        null,
      );
    }
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    expect((await closeDueVotes(env.DB, 10)).roundsAdvanced).toEqual([vote.id]);
    expect(await queryAll(env.DB, "SELECT current_round, closed_at FROM votes WHERE id = ?", vote.id)).toEqual([
      { current_round: 2, closed_at: null },
    ]);

    for (const voter of voters) {
      await submitBallot(
        env.DB,
        await resolveAuthMember(env.DB, voter.userId),
        vote.id,
        null,
        byName.get("Alice")!,
        null,
      );
    }
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    expect((await closeDueVotes(env.DB, 10)).closed).toEqual([vote.id]);
    const [closed] = await queryAll<{ closed_at: string | null; result_json: string }>(
      env.DB,
      "SELECT closed_at, result_json FROM votes WHERE id = ?",
      vote.id,
    );
    expect(closed.closed_at).not.toBeNull();
    expect(JSON.parse(closed.result_json)).toMatchObject({ winnerCandidateId: byName.get("Alice") });
  });

  it("defers excess closures under a constrained D1 query budget", async () => {
    const first = await createCanonicalVote(env.DB, admin, { title: "Budgeted close one" });
    const second = await createCanonicalVote(env.DB, admin, { title: "Budgeted close two" });
    const past = new Date(Date.now() - 1_000).toISOString();
    await env.DB.prepare("UPDATE votes SET closes_at = ? WHERE id IN (?, ?)").bind(past, first.id, second.id).run();
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 7);
    const result = await closeDueVotes(budgeted.db, 10, budgeted.budget);
    expect(result.closed).toHaveLength(1);
    expect((await closeDueVotes(env.DB, 10)).closed).toHaveLength(1);
  });

  it("keeps concurrent scheduled openings and notification snapshots idempotent", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 120_000).toISOString(),
    });
    await env.DB.prepare("UPDATE votes SET opens_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    const results = await Promise.all([closeDueVotes(env.DB, 10), closeDueVotes(env.DB, 10)]);
    expect(results.flatMap((result) => result.opened)).toEqual([vote.id]);
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_representative_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'vote_opened_automatically'",
        vote.id,
      ),
    ).toHaveLength(1);
  });
});
