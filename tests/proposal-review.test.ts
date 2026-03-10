import { describe, it, expect } from "vitest";
import { onRequestPost as upsertReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestPost as finalizeProposal } from "../functions/api/v1/admin/proposals/[proposalId]/finalize";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createAdminSession } from "./helpers/auth";

async function seedProposal(db: D1DatabaseShim, eventId: string): Promise<{ proposalId: string; admin1Id: string; admin2Id: string }> {
  const proposalId = crypto.randomUUID();
  const proposerId = crypto.randomUUID();

  const adminRows = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1");
  const admin1Id = adminRows[0].id;
  const admin2Id = crypto.randomUUID();

  await db.exec?.(`
    INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
    VALUES ('${admin2Id}', 'committee2@pkic.org', 'committee2@pkic.org', 'admin', 1, datetime('now'), datetime('now'));

    INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
    VALUES ('${proposerId}', 'speaker@pkic.org', 'speaker@pkic.org', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'));

    INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
    ) VALUES (
      '${proposalId}', '${eventId}', '${proposerId}', 'submitted', 'talk', 'Test Proposal',
      'Abstract', '{}', NULL, 'hash', datetime('now'), datetime('now'), NULL
    );
  `);

  return { proposalId, admin1Id, admin2Id };
}

describe("proposal review and finalize", () => {
  it("enforces minimum reviews before final decision", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const { proposalId, admin1Id, admin2Id } = await seedProposal(db, eventId);
    const env = createEnv(db);

    await createAdminSession(db, admin1Id, "token-admin-1");
    await createAdminSession(db, admin2Id, "token-admin-2");

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

    const decisions = db.raw<{ total: number }>("SELECT COUNT(*) AS total FROM proposal_decisions WHERE proposal_id = ?", [proposalId]);
    expect(Number(decisions[0].total)).toBe(1);

    const status = db.raw<{ status: string }>("SELECT status FROM session_proposals WHERE id = ?", [proposalId]);
    expect(status[0].status).toBe("accepted");
  });
});
