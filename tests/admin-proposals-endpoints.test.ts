import { describe, expect, it } from "vitest";
import { onRequestGet as getEventProposals } from "../functions/api/v1/admin/events/[eventSlug]/proposals";
import { onRequestGet as getProposalReviews } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createAdminSession } from "./helpers/auth";

async function seedProposalWithReviews(db: D1DatabaseShim, eventId: string): Promise<{ proposalId: string; adminId: string }> {
  const proposalId = crypto.randomUUID();
  const proposerId = crypto.randomUUID();

  const adminRow = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")[0];
  const adminId = adminRow.id;

  await db.exec?.(`
    INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
    VALUES ('${proposerId}', 'speaker@pkic.org', 'speaker@pkic.org', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'));

    INSERT INTO session_proposals (
      id, event_id, proposer_user_id, status, proposal_type, title, abstract,
      details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
    ) VALUES (
      '${proposalId}', '${eventId}', '${proposerId}', 'submitted', 'talk', 'Endpoint Proposal',
      'Proposal abstract that is long enough to represent realistic content for testing.',
      '{}', NULL, 'hash', datetime('now'), datetime('now'), NULL
    );

    INSERT INTO proposal_reviews (
      id, proposal_id, reviewer_user_id, recommendation, score,
      reviewer_comment, applicant_note, created_at, updated_at
    ) VALUES (
      '${crypto.randomUUID()}', '${proposalId}', '${adminId}', 'accept', 9,
      'Strong scope and relevance', 'Please include timing details', datetime('now'), datetime('now')
    );

    INSERT INTO proposal_decisions (
      id, proposal_id, decided_by_user_id, final_status,
      decision_note, min_reviews_required, review_count, decided_at
    ) VALUES (
      '${crypto.randomUUID()}', '${proposalId}', '${adminId}', 'accepted',
      'Accepted by committee', 1, 1, datetime('now')
    );
  `);

  return { proposalId, adminId };
}

describe("admin proposal endpoints", () => {
  it("returns proposal list with proposer, review and decision metadata", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const { adminId } = await seedProposalWithReviews(db, eventId);
    const env = createEnv(db);

    await createAdminSession(db, adminId, "token-admin-list");

    const response = await getEventProposals(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/proposals", {
          headers: { authorization: "Bearer token-admin-list" },
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      proposals: Array<{
        proposer_email: string;
        review_count: number;
        decision_status: string | null;
      }>;
    };

    expect(payload.proposals.length).toBe(1);
    expect(payload.proposals[0].proposer_email).toBe("speaker@pkic.org");
    expect(Number(payload.proposals[0].review_count)).toBe(1);
    expect(payload.proposals[0].decision_status).toBe("accepted");
  });

  it("returns review list including reviewer identity fields", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const { proposalId, adminId } = await seedProposalWithReviews(db, eventId);
    const env = createEnv(db);

    await createAdminSession(db, adminId, "token-admin-reviews");

    const response = await getProposalReviews(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          headers: { authorization: "Bearer token-admin-reviews" },
        }),
        { proposalId },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      reviews: Array<{ reviewer_email?: string; reviewer_first_name?: string | null }>;
    };

    expect(payload.reviews.length).toBe(1);
    expect(payload.reviews[0].reviewer_email).toBe("admin@pkic.org");
    expect(payload.reviews[0].reviewer_first_name ?? null).toBeNull();
  });
});
