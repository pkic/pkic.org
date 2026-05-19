import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { onRequestGet as getEventProposals } from "../functions/api/v1/admin/events/[eventSlug]/proposals";
import { onRequestGet as getProposalDetail } from "../functions/api/v1/admin/proposals/[proposalId]";
import { onRequestPost as openProposalManage } from "../functions/api/v1/admin/proposals/[proposalId]/open-manage";
import { onRequestGet as getProposalReviews } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { getProposalByManageToken } from "../functions/_lib/services/proposals";

const proposalDetails = {
  audience: "Operators",
  format: "panel",
  tracks: ["pki", "policy"],
  recordingConsent: true,
};

const proposalDetailsJson = JSON.stringify(proposalDetails);

async function seedProposalWithReviews(
  _db: DatabaseLike,
  eventId: string,
): Promise<{ proposalId: string; adminId: string }> {
  const proposalId = crypto.randomUUID();
  const proposerId = crypto.randomUUID();
  const formId = crypto.randomUUID();

  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  const adminId = adminRow.id;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
      VALUES ('${proposerId}', 'speaker@pkic.org', 'speaker@pkic.org', 'Speaker', 'One', 'Org', 'Role', NULL, datetime('now'), datetime('now'))
    `),
    env.DB.prepare(`
      INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
      ) VALUES (
        '${proposalId}', '${eventId}', '${proposerId}', 'submitted', 'talk', 'Endpoint Proposal',
        'Proposal abstract that is long enough to represent realistic content for testing.',
        '${proposalDetailsJson}', NULL, 'hash', datetime('now'), datetime('now'), NULL
      )
    `),
    env.DB.prepare(`
      INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
      VALUES (
        '${formId}',
        'proposal-form-${eventId}',
        'event',
        '${eventId}',
        'proposal_submission',
        'active',
        'CFP Form',
        'Structured questions for proposals',
        datetime('now'),
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO form_fields (
        id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at
      ) VALUES (
        '${crypto.randomUUID()}',
        '${formId}',
        'audience',
        'Target audience',
        'text',
        1,
        NULL,
        NULL,
        1,
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO form_fields (
        id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at
      ) VALUES (
        '${crypto.randomUUID()}',
        '${formId}',
        'format',
        'Preferred format',
        'select',
        1,
        '[{"value":"talk","label":"Talk"},{"value":"panel","label":"Panel discussion"}]',
        NULL,
        2,
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO form_fields (
        id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at
      ) VALUES (
        '${crypto.randomUUID()}',
        '${formId}',
        'tracks',
        'Tracks',
        'multi_select',
        0,
        '[{"value":"pki","label":"PKI"},{"value":"policy","label":"Policy"}]',
        NULL,
        3,
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO form_fields (
        id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at
      ) VALUES (
        '${crypto.randomUUID()}',
        '${formId}',
        'recordingConsent',
        'Recording consent',
        'boolean',
        0,
        NULL,
        NULL,
        4,
        datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO proposal_reviews (
        id, proposal_id, reviewer_user_id, recommendation, score,
        reviewer_comment, applicant_note, created_at, updated_at
      ) VALUES (
        '${crypto.randomUUID()}', '${proposalId}', '${adminId}', 'accept', 9,
        'Strong scope and relevance', 'Please include timing details', datetime('now'), datetime('now')
      )
    `),
    env.DB.prepare(`
      INSERT INTO proposal_decisions (
        id, proposal_id, decided_by_user_id, final_status,
        decision_note, min_reviews_required, review_count, decided_at
      ) VALUES (
        '${crypto.randomUUID()}', '${proposalId}', '${adminId}', 'accepted',
        'Accepted by committee', 1, 1, datetime('now')
      )
    `),
  ]);

  return { proposalId, adminId };
}

describe("admin proposal endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("returns proposal list with proposer, review and decision metadata", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);

    await createAdminSession(env.DB, adminId, "token-admin-list");

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

  it("returns proposal detail with parsed answers and active form fields", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);

    await createAdminSession(env.DB, adminId, "token-admin-detail");

    const response = await getProposalDetail(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}`, {
          headers: { authorization: "Bearer token-admin-detail" },
        }),
        { proposalId },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      proposal: { details: Record<string, unknown> | null };
      form: { title: string; fields: Array<{ key: string; label: string; fieldType: string }> } | null;
    };

    expect(payload.proposal.details).toEqual(proposalDetails);
    expect(payload.form?.title).toBe("CFP Form");
    expect(payload.form?.fields.map((field) => [field.key, field.label, field.fieldType])).toEqual([
      ["audience", "Target audience", "text"],
      ["format", "Preferred format", "select"],
      ["tracks", "Tracks", "multi_select"],
      ["recordingConsent", "Recording consent", "boolean"],
    ]);
  });

  it("returns review list including reviewer identity fields", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);

    await createAdminSession(env.DB, adminId, "token-admin-reviews");

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

  it("refreshes the proposer manage token and returns a working manage URL", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);

    await createAdminSession(env.DB, adminId, "token-admin-manage");

    const response = await openProposalManage(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/open-manage`, {
          method: "POST",
          headers: { authorization: "Bearer token-admin-manage" },
        }),
        { proposalId },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { manageUrl: string };
    const url = new URL(payload.manageUrl);
    const token = url.searchParams.get("token");

    expect(url.pathname).toContain("/propose/manage/");
    expect(token).toBeTruthy();

    const proposal = await getProposalByManageToken(env.DB, token!);
    expect(proposal.id).toBe(proposalId);
  });
});
