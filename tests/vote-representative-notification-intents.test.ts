import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { runVotesDueWork } from "../functions/_lib/services/votes-scheduled-jobs";
import { transitionManagedVote } from "../functions/_lib/services/votes";
import { addRepresentative, insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import {
  TEST_GROUPS,
  createCanonicalVote,
  createOrganizationCapacity,
  joinVotingGroup,
  seedVotingAdmin,
} from "./helpers/voting";
import { renderEmail } from "../functions/_lib/email/render";

describe("durable vote representative notifications", () => {
  let admin: Awaited<ReturnType<typeof seedVotingAdmin>>["admin"];

  beforeEach(async () => {
    await resetDb();
    ({ admin } = await seedVotingAdmin(env.DB));
  });

  it("snapshots every participating representative once for each eligible Member", async () => {
    const capacityA = await createOrganizationCapacity(env.DB, { organizationName: "Eligible A" });
    const capacityB = await createOrganizationCapacity(env.DB, {
      userId: capacityA.userId,
      category: "B",
      organizationName: "Eligible B",
    });
    const participatingRepresentative = await insertUser(env.DB, "participating-rep@example.test");
    const nonParticipant = await insertUser(env.DB, "non-participant-rep@example.test");
    await addRepresentative(env.DB, capacityA.memberId, participatingRepresentative);
    await addRepresentative(env.DB, capacityA.memberId, nonParticipant);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacityA.userId, [capacityA.memberId, capacityB.memberId]);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, participatingRepresentative, [capacityA.memberId]);

    const vote = await createCanonicalVote(env.DB, admin, { eligibleCategories: ["A", "B"] });
    const intents = await queryAll<{ member_id: string; representative_user_id: string }>(
      env.DB,
      `SELECT member_id, representative_user_id
       FROM vote_representative_notification_intents
       WHERE vote_id = ? ORDER BY member_id, representative_user_id`,
      vote.id,
    );
    expect(intents).toEqual(
      [
        { member_id: capacityA.memberId, representative_user_id: capacityA.userId },
        { member_id: capacityA.memberId, representative_user_id: participatingRepresentative },
        { member_id: capacityB.memberId, representative_user_id: capacityA.userId },
      ].sort((left, right) =>
        `${left.member_id}:${left.representative_user_id}`.localeCompare(
          `${right.member_id}:${right.representative_user_id}`,
        ),
      ),
    );
    expect(intents.some((intent) => intent.representative_user_id === nonParticipant)).toBe(false);
  });

  it("does not create organization notifications for per-person electorates", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, { electorateMode: "per_person" });
    expect(
      await queryAll(env.DB, "SELECT vote_id FROM vote_representative_notification_intents WHERE vote_id = ?", vote.id),
    ).toHaveLength(0);
  });

  it("keeps the event-time snapshot after representation changes", async () => {
    const capacity = await createOrganizationCapacity(env.DB, { organizationName: "Snapshot Organization" });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const revokedAt = new Date(Date.now() + 1_000).toISOString();
    await env.DB.prepare(
      `UPDATE organization_representatives
       SET left_at = ?, blocked_at = ?
       WHERE member_id = ? AND user_id = ?`,
    )
      .bind(revokedAt, revokedAt, capacity.memberId, capacity.userId)
      .run();
    expect(
      await queryAll<{ representative_user_id: string }>(
        env.DB,
        "SELECT representative_user_id FROM vote_representative_notification_intents WHERE vote_id = ?",
        vote.id,
      ),
    ).toEqual([{ representative_user_id: capacity.userId }]);
  });

  it("drains an immutable snapshot after the vote has already closed and remains idempotent", async () => {
    const capacity = await createOrganizationCapacity(env.DB, {
      organizationName: '[Organization](https://attacker.invalid/org) <img src="https://attacker.invalid/org.gif">',
    });
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      title: '[Vote](https://attacker.invalid/vote) <script src="https://attacker.invalid/vote.js"></script>',
    });
    await env.DB.prepare("UPDATE votes SET status = 'closed' WHERE id = ?").bind(vote.id).run();

    const first = await runVotesDueWork(env.DB, env, 10);
    const second = await runVotesDueWork(env.DB, env, 10);
    expect(first.representativeNoticesQueued).toBe(1);
    expect(second.representativeNoticesQueued).toBe(0);
    expect(
      await queryAll<{ template_key: string; recipient_user_id: string }>(
        env.DB,
        "SELECT template_key, recipient_user_id FROM email_outbox WHERE idempotency_key LIKE 'member-vote-representative-notify:%'",
      ),
    ).toEqual([{ template_key: "member-vote-representative-notify", recipient_user_id: capacity.userId }]);
    const [queued] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE idempotency_key LIKE 'member-vote-representative-notify:%'",
    );
    const payload = JSON.parse(queued.payload_json) as Record<string, unknown>;
    for (const contentType of ["markdown", "html"] as const) {
      const rendered = await renderEmail(
        "{{representativeName}} {{organizationName}} {{voteTitle}}",
        payload,
        "<!doctype html><html><body>{{{body_html}}}</body></html>",
        contentType,
      );
      expect(rendered.html).not.toMatch(/<(?:a|img|script)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
      expect(rendered.text).toContain("attacker.invalid");
    }
  });

  it("rolls back a scheduled opening when its notification snapshot fails", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin, {
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 120_000).toISOString(),
    });
    await env.DB.prepare("UPDATE votes SET opens_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), vote.id)
      .run();
    await env.DB.prepare(
      `CREATE TRIGGER test_reject_vote_notification_intent
       BEFORE INSERT ON vote_representative_notification_intents
       BEGIN SELECT RAISE(ABORT, 'notification snapshot rejected by test'); END`,
    ).run();

    await expect(runVotesDueWork(env.DB, env, 10)).rejects.toThrow("notification snapshot rejected by test");
    expect(await queryAll(env.DB, "SELECT status FROM votes WHERE id = ?", vote.id)).toEqual([{ status: "scheduled" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'vote_opened_automatically'",
        vote.id,
      ),
    ).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER test_reject_vote_notification_intent").run();
    expect((await runVotesDueWork(env.DB, env, 10)).opened).toBe(1);
  });

  it("defers notification delivery when the invocation budget cannot cover the atomic queue operation", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 2);
    const deferred = await runVotesDueWork(budgeted.db, env, 0, budgeted.budget);
    expect(deferred.representativeNoticesQueued).toBe(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT vote_id FROM vote_representative_notification_intents WHERE vote_id = ? AND queued_outbox_id IS NULL",
        vote.id,
      ),
    ).toHaveLength(1);
    expect((await runVotesDueWork(env.DB, env, 0)).representativeNoticesQueued).toBe(1);
  });

  it("cancels queued representative notices when an open vote is cancelled", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    expect((await runVotesDueWork(env.DB, env, 0)).representativeNoticesQueued).toBe(1);

    await transitionManagedVote(
      env.DB,
      admin,
      vote.id,
      { transition: "cancel", reason: "The vote is no longer required" },
      TEST_GROUPS.pqc,
    );
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM email_outbox WHERE idempotency_key LIKE 'member-vote-representative-notify:%'",
      ),
    ).toEqual([{ status: "cancelled" }]);
  });

  it("does not queue a representative notice after concurrent cancellation retracts its intent", async () => {
    const capacity = await createOrganizationCapacity(env.DB);
    await joinVotingGroup(env.DB, TEST_GROUPS.pqc, capacity.userId, [capacity.memberId]);
    const vote = await createCanonicalVote(env.DB, admin);
    const gate = gateNextBatch(env.DB);
    const pendingQueue = runVotesDueWork(gate.db, env, 0);
    await gate.reached;
    await transitionManagedVote(
      env.DB,
      admin,
      vote.id,
      { transition: "cancel", reason: "Cancelled before notices were queued" },
      TEST_GROUPS.pqc,
    );
    gate.release();

    expect((await pendingQueue).representativeNoticesQueued).toBe(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'member-vote-representative-notify:%'",
      ),
    ).toHaveLength(0);
  });
});
