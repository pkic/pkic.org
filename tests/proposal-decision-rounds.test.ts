import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import type { DatabaseLike } from "../functions/_lib/types";
import { createProposal, addProposalSpeaker, updateProposalByManageToken } from "../functions/_lib/services/proposals";
import { buildProposalDecisionEmailPlan, recordProposalDecision } from "../functions/_lib/services/proposal-decisions";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { proposalReviewsListResponseSchema } from "../assets/shared/schemas/proposal-reviews";

function decisionActor(id: string) {
  return { id, email: "admin@pkic.org", role: "admin" };
}

interface SeededDecisionWorkflow {
  proposalId: string;
  manageToken: string;
  adminId: string;
  adminToken: string;
  reviewerTokens: string[];
}

function callApp(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdmin(path: string, token: string, method = "GET", body?: unknown): Promise<Response> {
  return callApp(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedDecisionWorkflow(): Promise<SeededDecisionWorkflow> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const proposerId = crypto.randomUUID();
  const reviewerIds = [crypto.randomUUID(), crypto.randomUUID()];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'round-proposer@pkic.org', 'round-proposer@pkic.org', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(proposerId),
    ...reviewerIds.map((reviewerId, index) =>
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, ?, ?, 'admin', 1, datetime('now'), datetime('now'))`,
      ).bind(reviewerId, `round-reviewer-${index}@pkic.org`, `round-reviewer-${index}@pkic.org`),
    ),
  ]);
  const { proposal, manageToken } = await createProposal(env.DB, {
    eventId,
    proposerUserId: proposerId,
    proposalType: "talk",
    title: "A proposal that needs two review rounds",
    abstract: "A sufficiently detailed proposal abstract used to verify independent review rounds and decisions.",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  await addProposalSpeaker(env.DB, { proposalId: proposal.id, userId: proposerId, role: "proposer" });

  return {
    proposalId: proposal.id,
    manageToken,
    adminId: admin.id,
    adminToken: await createAdminSession(env.DB, admin.id, "decision-round-admin"),
    reviewerTokens: await Promise.all(
      reviewerIds.map((reviewerId, index) =>
        createAdminSession(env.DB, reviewerId, `decision-round-reviewer-${index}`),
      ),
    ),
  };
}

async function saveReview(proposalId: string, token: string, score: number): Promise<Response> {
  return callAdmin(`/api/v1/admin/proposals/${proposalId}/reviews`, token, "POST", {
    recommendation: "accept",
    score,
  });
}

async function finalize(proposalId: string, token: string, finalStatus: "accepted" | "rejected" | "needs-work") {
  return callAdmin(`/api/v1/admin/proposals/${proposalId}/finalize`, token, "POST", {
    finalStatus,
    decisionNote: finalStatus === "needs-work" ? "Please revise the proposal." : undefined,
  });
}

async function buildAcceptedDecisionPlan(seeded: SeededDecisionWorkflow) {
  return buildProposalDecisionEmailPlan(
    env.DB,
    {
      proposalId: seeded.proposalId,
      actor: decisionActor(seeded.adminId),
      finalStatus: "accepted",
    },
    {
      appBaseUrl: "https://app.test",
      resolveSpeakerManageUrl: async (speaker) => `https://app.test/speakers/${speaker.speaker_id}`,
      resolveProposalManageUrl: async (_event, proposalId) => `https://app.test/proposals/${proposalId}`,
    },
  );
}

describe("proposal decision review rounds", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a direct decision command from an actor without proposals:manage", async () => {
    const seeded = await seedDecisionWorkflow();

    await expect(
      recordProposalDecision(env.DB, {
        proposalId: seeded.proposalId,
        actor: { id: seeded.adminId, email: "admin@pkic.org", role: "user", grants: [] },
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
  });

  it("requires fresh reviews after needs-work and retains both decision rounds", async () => {
    const seeded = await seedDecisionWorkflow();
    for (const [index, token] of seeded.reviewerTokens.entries()) {
      expect((await saveReview(seeded.proposalId, token, 8 + index)).status).toBe(200);
    }
    expect((await finalize(seeded.proposalId, seeded.adminToken, "needs-work")).status).toBe(200);

    const resubmit = await callApp(`/api/v1/proposals/manage/${encodeURIComponent(seeded.manageToken)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", title: "A revised proposal for the second review round" }),
    });
    expect(resubmit.status).toBe(200);
    const [resubmitted] = await queryAll<{ status: string; review_round: number }>(
      env.DB,
      "SELECT status, review_round FROM session_proposals WHERE id = ?",
      [seeded.proposalId],
    );
    expect(resubmitted).toEqual({ status: "resubmitted", review_round: 2 });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll<{ review_round: number; final_status: string }>(
        env.DB,
        "SELECT review_round, final_status FROM proposal_decision_history WHERE proposal_id = ? ORDER BY review_round",
        [seeded.proposalId],
      ),
    ).resolves.toEqual([{ review_round: 1, final_status: "needs-work" }]);
    await expect(
      queryAll<{ review_round: number; score: number }>(
        env.DB,
        "SELECT review_round, score FROM proposal_review_history WHERE proposal_id = ? ORDER BY score",
        [seeded.proposalId],
      ),
    ).resolves.toEqual([
      { review_round: 1, score: 8 },
      { review_round: 1, score: 9 },
    ]);

    const emptyRound = proposalReviewsListResponseSchema.parse(
      await (await callAdmin(`/api/v1/admin/proposals/${seeded.proposalId}/reviews`, seeded.adminToken)).json(),
    );
    expect(emptyRound.summary.totalReviews).toBe(0);
    expect(emptyRound.reviews).toEqual([]);
    expect(emptyRound.myReview).toBeNull();
    const belowQuorum = await finalize(seeded.proposalId, seeded.adminToken, "accepted");
    expect(belowQuorum.status).toBe(409);
    await expect(belowQuorum.json()).resolves.toMatchObject({
      error: { code: "PROPOSAL_REVIEW_THRESHOLD_NOT_MET" },
    });

    expect((await saveReview(seeded.proposalId, seeded.reviewerTokens[0], 9)).status).toBe(200);
    expect((await finalize(seeded.proposalId, seeded.adminToken, "accepted")).status).toBe(409);
    expect((await saveReview(seeded.proposalId, seeded.reviewerTokens[1], 10)).status).toBe(200);
    const accepted = await finalize(seeded.proposalId, seeded.adminToken, "accepted");
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({ reviewRound: 2, reviewCount: 2 });

    await expect(
      queryAll<{ review_round: number; final_status: string }>(
        env.DB,
        "SELECT review_round, final_status FROM proposal_decision_history WHERE proposal_id = ? ORDER BY review_round",
        [seeded.proposalId],
      ),
    ).resolves.toEqual([
      { review_round: 1, final_status: "needs-work" },
      { review_round: 2, final_status: "accepted" },
    ]);
    await expect(
      queryAll<{ review_round: number; score: number }>(
        env.DB,
        "SELECT review_round, score FROM proposal_review_history WHERE proposal_id = ? ORDER BY review_round, score",
        [seeded.proposalId],
      ),
    ).resolves.toEqual([
      { review_round: 1, score: 8 },
      { review_round: 1, score: 9 },
      { review_round: 2, score: 9 },
      { review_round: 2, score: 10 },
    ]);
    await expect(
      queryAll<{ review_round: number }>(
        env.DB,
        "SELECT review_round FROM proposal_reviews WHERE proposal_id = ? ORDER BY reviewer_user_id",
        [seeded.proposalId],
      ),
    ).resolves.toEqual([{ review_round: 2 }, { review_round: 2 }]);
  });

  it("rolls back resubmission, decision release, and audit together", async () => {
    const seeded = await seedDecisionWorkflow();
    await recordProposalDecision(env.DB, {
      proposalId: seeded.proposalId,
      actor: decisionActor(seeded.adminId),
      finalStatus: "needs-work",
      decisionNote: "Revise this proposal.",
      minReviewsRequired: 0,
    });
    await env.DB.prepare(
      `CREATE TRIGGER fail_resubmission_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'proposal_edited'
       BEGIN SELECT RAISE(ABORT, 'forced resubmission audit failure'); END`,
    ).run();

    const response = await callApp(`/api/v1/proposals/manage/${encodeURIComponent(seeded.manageToken)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", title: "This must roll back" }),
    });
    expect(response.status).toBe(500);
    const [proposal] = await queryAll<{ status: string; review_round: number; title: string }>(
      env.DB,
      "SELECT status, review_round, title FROM session_proposals WHERE id = ?",
      [seeded.proposalId],
    );
    expect(proposal).toMatchObject({ status: "needs-work", review_round: 1 });
    expect(proposal.title).not.toBe("This must roll back");
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(1);
  });

  it("does not record decision fallout when withdrawal wins the compare-and-set race", async () => {
    const seeded = await seedDecisionWorkflow();
    const baseDb: DatabaseLike = env.DB;
    const plan = await buildAcceptedDecisionPlan(seeded);
    let injectedWithdrawal = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedWithdrawal) {
          injectedWithdrawal = true;
          await baseDb
            .prepare("UPDATE session_proposals SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?")
            .bind(seeded.proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      recordProposalDecision(racingDb, {
        proposalId: seeded.proposalId,
        actor: decisionActor(seeded.adminId),
        finalStatus: "accepted",
        minReviewsRequired: 0,
        expectedProposalUpdatedAt: plan.proposal.updated_at,
        expectedEventSnapshot: plan.eventSnapshot,
        expectedSpeakerSnapshot: plan.speakerSnapshot,
        notifications: plan.messages,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_NOT_DECIDABLE" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT review_id FROM proposal_review_history WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'proposal-decision:%'"),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action LIKE 'proposal_decision%'", [
        seeded.proposalId,
      ]),
    ).resolves.toHaveLength(0);
  });

  it("does not queue stale decision emails when the speaker set changes before the atomic write", async () => {
    const seeded = await seedDecisionWorkflow();
    const plan = await buildAcceptedDecisionPlan(seeded);
    const baseDb: DatabaseLike = env.DB;
    let injectedSpeakerChange = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedSpeakerChange) {
          injectedSpeakerChange = true;
          await baseDb
            .prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ?")
            .bind(seeded.proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      recordProposalDecision(racingDb, {
        proposalId: seeded.proposalId,
        actor: decisionActor(seeded.adminId),
        finalStatus: "accepted",
        minReviewsRequired: 0,
        expectedProposalUpdatedAt: plan.proposal.updated_at,
        expectedEventSnapshot: plan.eventSnapshot,
        expectedSpeakerSnapshot: plan.speakerSnapshot,
        presentationReminderUserIds: plan.presentationReminderUserIds,
        notifications: plan.messages,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_DECISION_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'proposal-decision:%'"),
    ).resolves.toHaveLength(0);
  });

  it("keeps the needs-work decision when moderation wins the resubmission race", async () => {
    const seeded = await seedDecisionWorkflow();
    await recordProposalDecision(env.DB, {
      proposalId: seeded.proposalId,
      actor: decisionActor(seeded.adminId),
      finalStatus: "needs-work",
      decisionNote: "Revise this proposal before resubmitting.",
      minReviewsRequired: 0,
    });
    const baseDb: DatabaseLike = env.DB;
    let injectedModeration = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedModeration) {
          injectedModeration = true;
          await baseDb
            .prepare("UPDATE session_proposals SET status = 'spam', updated_at = datetime('now') WHERE id = ?")
            .bind(seeded.proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      updateProposalByManageToken(racingDb, {
        manageToken: seeded.manageToken,
        action: "update",
        title: "A losing resubmission",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_EDIT_CONFLICT" });
    const [proposal] = await queryAll<{ status: string; review_round: number }>(
      env.DB,
      "SELECT status, review_round FROM session_proposals WHERE id = ?",
      [seeded.proposalId],
    );
    expect(proposal).toEqual({ status: "spam", review_round: 1 });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [seeded.proposalId]),
    ).resolves.toHaveLength(1);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'proposal_edited'", [
        seeded.proposalId,
      ]),
    ).resolves.toHaveLength(0);
  });
});
