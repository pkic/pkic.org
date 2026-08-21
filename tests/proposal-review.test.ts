import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { AuthAdmin, DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { upsertProposalReview } from "../functions/_lib/services/proposal-reviews";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import app from "../functions/router";

async function callProposalReview(
  token: string,
  proposalId: string,
  suffix = "",
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews${suffix}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function seedProposal(
  _db: DatabaseLike,
  eventId: string,
): Promise<{ proposalId: string; admin1Id: string; admin2Id: string }> {
  const proposalId = crypto.randomUUID();
  const proposerId = crypto.randomUUID();

  const adminRows = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
  );
  const admin1Id = adminRows[0].id;
  const admin2Id = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${admin2Id}', 'committee2@pkic.org', 'committee2@pkic.org', 'admin', 1, datetime('now'), datetime('now'))
    `),
    env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES ('${proposerId}', 'speaker@pkic.org', 'speaker@pkic.org', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'))
    `),
    env.DB.prepare(`
      INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
      ) VALUES (
        '${proposalId}', '${eventId}', '${proposerId}', 'submitted', 'talk', 'Test Proposal',
        'Abstract', '{}', NULL, 'hash', datetime('now'), datetime('now'), NULL
      )
    `),
  ]);

  return { proposalId, admin1Id, admin2Id };
}

describe("proposal review and finalize", () => {
  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare("DROP TRIGGER IF EXISTS fail_proposal_review_audit").run();
    await env.DB.prepare("DROP TRIGGER IF EXISTS ignore_proposal_review_update").run();
  });

  it("writes consistent audit deltas for review create and patch, and skips no-op saves", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);

    const admin1Token = await createAdminSession(env.DB, admin1Id, "token-admin-1");

    const createResponse = await callProposalReview(admin1Token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
    });

    expect(createResponse.status).toBe(200);

    const createdAuditRows = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'proposal_review_upserted' ORDER BY created_at ASC",
    );
    expect(createdAuditRows).toHaveLength(1);
    expect(JSON.parse(createdAuditRows[0].details_json)).toMatchObject({
      recommendation: { from: null, to: "accept" },
      score: { from: null, to: 9 },
      reviewerComment: { from: null, to: "Good" },
    });

    const noOpResponse = await callProposalReview(admin1Token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
    });

    expect(noOpResponse.status).toBe(200);

    const noOpAuditCount = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'proposal_review_upserted'",
    );
    expect(Number(noOpAuditCount[0].total)).toBe(1);

    const reviews = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
      [proposalId, admin1Id],
    );

    const patchResponse = await callProposalReview(admin1Token, proposalId, `/${reviews[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ score: 10, reviewerComment: "Excellent", applicantNote: "Ready for acceptance" }),
    });

    expect(patchResponse.status).toBe(200);

    const patchedAuditRows = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'proposal_review_upserted' ORDER BY created_at ASC",
    );
    expect(patchedAuditRows).toHaveLength(2);
    expect(JSON.parse(patchedAuditRows[1].details_json)).toMatchObject({
      score: { from: 9, to: 10 },
      reviewerComment: { from: "Good", to: "Excellent" },
      applicantNote: { from: null, to: "Ready for acceptance" },
    });
  });

  it("rolls back a review create when the audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const token = await createAdminSession(env.DB, admin1Id, "token-review-audit-rollback");
    await env.DB.prepare(
      `CREATE TRIGGER fail_proposal_review_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'proposal_review_upserted'
       BEGIN
         SELECT RAISE(FAIL, 'forced proposal review audit failure');
       END`,
    ).run();

    const response = await callProposalReview(token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9 }),
    });

    expect(response.status).toBe(500);
    const reviews = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM proposal_reviews WHERE proposal_id = ?",
      [proposalId],
    );
    expect(Number(reviews[0].total)).toBe(0);
  });

  it("returns a conflict without an audit row when a compare-and-set review update loses", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const token = await createAdminSession(env.DB, admin1Id, "token-review-cas-conflict");
    await callProposalReview(token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9 }),
    });
    const [review] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
      [proposalId, admin1Id],
    );
    await env.DB.prepare(
      `CREATE TRIGGER ignore_proposal_review_update
       BEFORE UPDATE ON proposal_reviews
       WHEN NEW.score = 10
       BEGIN
         SELECT RAISE(IGNORE);
       END`,
    ).run();

    const response = await callProposalReview(token, proposalId, `/${review.id}`, {
      method: "PATCH",
      body: JSON.stringify({ score: 10 }),
    });

    expect(response.status).toBe(409);
    const [stored] = await queryAll<{ score: number }>(env.DB, "SELECT score FROM proposal_reviews WHERE id = ?", [
      review.id,
    ]);
    expect(stored.score).toBe(9);
    const [auditCount] = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'proposal_review_upserted'",
    );
    expect(Number(auditCount.total)).toBe(1);
  });

  it("rejects empty review patches before mutating the row", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const token = await createAdminSession(env.DB, admin1Id, "token-empty-review-patch");
    await callProposalReview(token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9 }),
    });
    const [before] = await queryAll<{ id: string; updated_at: string }>(
      env.DB,
      "SELECT id, updated_at FROM proposal_reviews WHERE proposal_id = ?",
      [proposalId],
    );

    const response = await callProposalReview(token, proposalId, `/${before.id}`, {
      method: "PATCH",
      body: "{}",
    });

    expect(response.status).toBe(400);
    const [after] = await queryAll<{ updated_at: string }>(
      env.DB,
      "SELECT updated_at FROM proposal_reviews WHERE id = ?",
      [before.id],
    );
    expect(after.updated_at).toBe(before.updated_at);
  });

  it("prevents a score-only reviewer from editing another review", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, admin1Id, "token-review-owner");
    await callProposalReview(adminToken, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9 }),
    });
    const [review] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM proposal_reviews WHERE proposal_id = ?", [
      proposalId,
    ]);
    const moderatorId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
           VALUES (?, 'moderator@pkic.org', 'moderator@pkic.org', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(moderatorId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-event_moderator', 'event', ?, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), moderatorId, eventId, admin1Id),
    ]);
    const moderatorToken = await createAdminSession(env.DB, moderatorId, "token-review-moderator");

    const response = await callProposalReview(moderatorToken, proposalId, `/${review.id}`, {
      method: "PATCH",
      body: JSON.stringify({ score: 1 }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects review changes after a proposal decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const token = await createAdminSession(env.DB, admin1Id, "token-finalized-review");
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();

    const response = await callProposalReview(token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9 }),
    });

    expect(response.status).toBe(409);
  });

  it("does not create a review when finalization wins immediately before the write", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const actor: AuthAdmin = { id: admin1Id, email: "admin@pkic.org", role: "admin" };
    const baseDb: DatabaseLike = env.DB;
    let injectedFinalization = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedFinalization) {
          injectedFinalization = true;
          await baseDb.batch([
            baseDb
              .prepare(
                `INSERT INTO proposal_decisions (
                   id, proposal_id, decided_by_user_id, final_status, decision_note,
                   min_reviews_required, review_count, decided_at
                 ) VALUES (?, ?, ?, 'accepted', NULL, 0, 0, datetime('now'))`,
              )
              .bind(crypto.randomUUID(), proposalId, admin1Id),
            baseDb.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId),
          ]);
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      upsertProposalReview(racingDb, actor, proposalId, { recommendation: "accept", score: 9 }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_ALREADY_FINALIZED" });

    expect(await queryAll(env.DB, "SELECT id FROM proposal_reviews WHERE proposal_id = ?", [proposalId])).toHaveLength(
      0,
    );
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_review_upserted'")).toHaveLength(
      0,
    );
  });

  it("does not update a review when finalization wins immediately before the write", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);
    const actor: AuthAdmin = { id: admin1Id, email: "admin@pkic.org", role: "admin" };
    await upsertProposalReview(env.DB, actor, proposalId, { recommendation: "accept", score: 9 });

    const baseDb: DatabaseLike = env.DB;
    let injectedFinalization = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedFinalization) {
          injectedFinalization = true;
          await baseDb.batch([
            baseDb
              .prepare(
                `INSERT INTO proposal_decisions (
                   id, proposal_id, decided_by_user_id, final_status, decision_note,
                   min_reviews_required, review_count, decided_at
                 ) VALUES (?, ?, ?, 'accepted', NULL, 1, 1, datetime('now'))`,
              )
              .bind(crypto.randomUUID(), proposalId, admin1Id),
            baseDb.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId),
          ]);
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      upsertProposalReview(racingDb, actor, proposalId, { recommendation: "accept", score: 10 }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_ALREADY_FINALIZED" });

    expect(
      await queryAll<{ score: number }>(env.DB, "SELECT score FROM proposal_reviews WHERE proposal_id = ?", [
        proposalId,
      ]),
    ).toEqual([{ score: 9 }]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_review_upserted'")).toHaveLength(
      1,
    );
  });

  it("enforces minimum reviews before final decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id, admin2Id } = await seedProposal(env.DB, eventId);

    const admin1Token = await createAdminSession(env.DB, admin1Id, "token-admin-1");
    const admin2Token = await createAdminSession(env.DB, admin2Id, "token-admin-2");

    await callProposalReview(admin1Token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
    });

    const belowQuorum = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin1Token}` },
        body: JSON.stringify({ finalStatus: "accepted" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(belowQuorum.status).toBe(409);
    await expect(belowQuorum.json()).resolves.toMatchObject({
      error: { code: "PROPOSAL_REVIEW_THRESHOLD_NOT_MET" },
    });

    await callProposalReview(admin2Token, proposalId, "", {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept", score: 8, reviewerComment: "Also good" }),
    });

    const finalizeResponse = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin1Token}` },
        body: JSON.stringify({ finalStatus: "accepted" }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(finalizeResponse.status).toBe(200);

    const decisions = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM proposal_decisions WHERE proposal_id = ?",
      [proposalId],
    );
    expect(Number(decisions[0].total)).toBe(1);

    const status = await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(status[0].status).toBe("accepted");
  });
});
