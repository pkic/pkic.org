import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { onRequestPost as upsertReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestPatch as patchReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews/[reviewId]";
import { onRequestPost as finalizeProposal } from "../functions/api/v1/admin/proposals/[proposalId]/finalize";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";

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
        details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
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
  });

  it("writes consistent audit deltas for review create and patch, and skips no-op saves", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id } = await seedProposal(env.DB, eventId);

    const admin1Token = await createAdminSession(env.DB, admin1Id, "token-admin-1");

    const createResponse = await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
        }),
        { proposalId },
      ),
    );

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

    const noOpResponse = await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
        }),
        { proposalId },
      ),
    );

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

    const patchResponse = await patchReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews/${reviews[0].id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ score: 10, reviewerComment: "Excellent", applicantNote: "Ready for acceptance" }),
        }),
        { proposalId, reviewId: reviews[0].id },
      ),
    );

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

  it("enforces minimum reviews before final decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id, admin2Id } = await seedProposal(env.DB, eventId);

    const admin1Token = await createAdminSession(env.DB, admin1Id, "token-admin-1");
    const admin2Token = await createAdminSession(env.DB, admin2Id, "token-admin-2");

    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good" }),
        }),
        { proposalId },
      ),
    );

    await expect(
      finalizeProposal(
        createContext(
          env,
          new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${admin1Token}`,
            },
            body: JSON.stringify({ finalStatus: "accepted", minReviewsRequired: 2 }),
          }),
          { proposalId },
        ),
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_REVIEW_THRESHOLD_NOT_MET" });

    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin2Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 8, reviewerComment: "Also good" }),
        }),
        { proposalId },
      ),
    );

    const finalizeResponse = await finalizeProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ finalStatus: "accepted", minReviewsRequired: 2 }),
        }),
        { proposalId },
      ),
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

  it("does not count draft reviews toward final decision threshold", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id, admin2Id } = await seedProposal(env.DB, eventId);

    const admin1Token = await createAdminSession(env.DB, admin1Id, "token-admin-1");
    const admin2Token = await createAdminSession(env.DB, admin2Id, "token-admin-2");

    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good", status: "draft" }),
        }),
        { proposalId },
      ),
    );

    const draftRows = await queryAll<{ status: string; submitted_at: string | null }>(
      env.DB,
      "SELECT status, submitted_at FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
      [proposalId, admin1Id],
    );
    expect(draftRows).toEqual([{ status: "draft", submitted_at: null }]);

    await expect(
      finalizeProposal(
        createContext(
          env,
          new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${admin1Token}`,
            },
            body: JSON.stringify({ finalStatus: "accepted", minReviewsRequired: 1 }),
          }),
          { proposalId },
        ),
      ),
    ).rejects.toMatchObject({ code: "PROPOSAL_REVIEW_THRESHOLD_NOT_MET" });

    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ recommendation: "accept", score: 9, reviewerComment: "Good", status: "submitted" }),
        }),
        { proposalId },
      ),
    );

    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin2Token}`,
          },
          body: JSON.stringify({
            recommendation: "accept",
            score: 8,
            reviewerComment: "Also good",
            status: "submitted",
          }),
        }),
        { proposalId },
      ),
    );

    const submittedRows = await queryAll<{ status: string; submitted_at: string | null }>(
      env.DB,
      "SELECT status, submitted_at FROM proposal_reviews WHERE proposal_id = ? AND reviewer_user_id = ?",
      [proposalId, admin1Id],
    );
    expect(submittedRows[0].status).toBe("submitted");
    expect(submittedRows[0].submitted_at).toBeTruthy();

    const finalizeResponse = await finalizeProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${admin1Token}`,
          },
          body: JSON.stringify({ finalStatus: "accepted", minReviewsRequired: 1 }),
        }),
        { proposalId },
      ),
    );

    expect(finalizeResponse.status).toBe(200);
  });
});
