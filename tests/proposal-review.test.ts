import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { onRequestPost as upsertReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
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
  it("enforces minimum reviews before final decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, admin1Id, admin2Id } = await seedProposal(env.DB, eventId);

    await createAdminSession(env.DB, admin1Id, "token-admin-1");
    await createAdminSession(env.DB, admin2Id, "token-admin-2");

    await upsertReview(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/proposals/p/reviews", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer token-admin-1",
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
          new Request("https://app.test/api/v1/admin/proposals/p/finalize", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer token-admin-1",
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
        new Request("https://app.test/api/v1/admin/proposals/p/reviews", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer token-admin-2",
          },
          body: JSON.stringify({ recommendation: "accept", score: 8, reviewerComment: "Also good" }),
        }),
        { proposalId },
      ),
    );

    const finalizeResponse = await finalizeProposal(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/proposals/p/finalize", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer token-admin-1",
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
});
