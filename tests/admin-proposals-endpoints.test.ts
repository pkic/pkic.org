import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { onRequestGet as getEventProposals } from "../functions/api/v1/admin/events/[eventSlug]/proposals";
import { onRequestGet as getProposalDetail } from "../functions/api/v1/admin/proposals/[proposalId]";
import { onRequestPost as openProposalManage } from "../functions/api/v1/admin/proposals/[proposalId]/open-manage";
import { onRequestGet as getProposalReviews } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestPatch as updateProposalSpeaker } from "../functions/api/v1/admin/proposals/[proposalId]/speakers/[userId]";
import {
  onRequestGet as getProposalComments,
  onRequestPost as addProposalComment,
} from "../functions/api/v1/admin/proposals/[proposalId]/comments";
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

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list");

    const response = await getEventProposals(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/proposals", {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      proposals: Array<{
        proposer_email: string;
        review_count: number;
        average_review_score: number | null;
        recommendation_accept_count: number;
        decision_status: string | null;
      }>;
      pagination: { total: number; hasMore: boolean };
      stats: {
        byStatus: Record<string, number>;
        byRecommendation: Record<string, number>;
        reviewedCount: number;
        unreviewedCount: number;
        total: number;
      };
    };

    expect(payload.proposals.length).toBe(1);
    expect(payload.proposals[0].proposer_email).toBe("speaker@pkic.org");
    expect(Number(payload.proposals[0].review_count)).toBe(1);
    expect(Number(payload.proposals[0].average_review_score)).toBe(9);
    expect(Number(payload.proposals[0].recommendation_accept_count)).toBe(1);
    expect(payload.proposals[0].decision_status).toBe("accepted");
    expect(payload.pagination.total).toBe(1);
    expect(payload.stats.byStatus.submitted).toBe(1);
    expect(payload.stats.byRecommendation.accept).toBe(1);
    expect(payload.stats.reviewedCount).toBe(1);
    expect(payload.stats.unreviewedCount).toBe(0);
    expect(payload.stats.total).toBe(1);
  });

  it("filters proposal list by recommendation and sorts by average score", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);
    const secondProposalId = crypto.randomUUID();
    const secondProposerId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${secondProposerId}', 'speaker-two@pkic.org', 'speaker-two@pkic.org', 'Speaker', 'Two', 'Org', 'Role', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO session_proposals (
          id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          details_json, referral_code, manage_token_hash, submitted_at, updated_at, withdrawn_at
        ) VALUES (
          '${secondProposalId}', '${eventId}', '${secondProposerId}', 'submitted', 'talk', 'Lower Score Proposal',
          'Another proposal abstract that is long enough to represent realistic content for testing.',
          NULL, NULL, 'hash-two', datetime('now', '-1 minute'), datetime('now'), NULL
        )
      `),
      env.DB.prepare(`
        INSERT INTO proposal_reviews (
          id, proposal_id, reviewer_user_id, recommendation, score,
          reviewer_comment, applicant_note, created_at, updated_at
        ) VALUES (
          '${crypto.randomUUID()}', '${secondProposalId}', '${adminId}', 'reject', 3,
          'Too narrow for this event', NULL, datetime('now'), datetime('now')
        )
      `),
    ]);

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list-sort");
    const scoreResponse = await getEventProposals(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/proposals?sort=score_asc", {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        { eventSlug: "pqc-2026" },
      ),
    );
    const scorePayload = (await scoreResponse.json()) as { proposals: Array<{ title: string }> };
    expect(scorePayload.proposals.map((proposal) => proposal.title)).toEqual([
      "Lower Score Proposal",
      "Endpoint Proposal",
    ]);

    const filterResponse = await getEventProposals(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/proposals?recommendation=reject", {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        { eventSlug: "pqc-2026" },
      ),
    );
    const filterPayload = (await filterResponse.json()) as {
      proposals: Array<{ title: string; recommendation_reject_count: number }>;
      pagination: { total: number };
    };
    expect(filterPayload.proposals).toHaveLength(1);
    expect(filterPayload.proposals[0].title).toBe("Lower Score Proposal");
    expect(Number(filterPayload.proposals[0].recommendation_reject_count)).toBe(1);
    expect(filterPayload.pagination.total).toBe(1);
  });

  it("updates a proposal speaker profile including links", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const speakerId = crypto.randomUUID();
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-speaker-profile");

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, biography, links_json, created_at, updated_at)
        VALUES ('${speakerId}', 'profile-speaker@example.test', 'profile-speaker@example.test', 'Profile', 'Speaker', 'Old Org', 'Old Role', NULL, NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, manage_token_hash, created_at)
        VALUES ('${crypto.randomUUID()}', '${proposalId}', '${speakerId}', 'speaker', 'pending', NULL, datetime('now'))
      `),
    ]);

    const response = await updateProposalSpeaker(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${speakerId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            firstName: "Updated",
            lastName: "Speaker",
            organizationName: "PKIC Labs",
            jobTitle: "Moderator",
            biography: "Updated biography from the admin proposal detail screen.",
            links: ["https://example.test/speaker", "https://github.com/speaker"],
            role: "moderator",
          }),
        }),
        { proposalId, userId: speakerId },
      ),
    );

    expect(response.status).toBe(200);
    const user = (
      await queryAll<{
        first_name: string | null;
        organization_name: string | null;
        job_title: string | null;
        biography: string | null;
        links_json: string | null;
      }>(env.DB, "SELECT first_name, organization_name, job_title, biography, links_json FROM users WHERE id = ?", [
        speakerId,
      ])
    )[0];
    const speaker = (
      await queryAll<{ role: string }>(
        env.DB,
        "SELECT role FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, speakerId],
      )
    )[0];
    expect(user.first_name).toBe("Updated");
    expect(user.organization_name).toBe("PKIC Labs");
    expect(user.job_title).toBe("Moderator");
    expect(user.biography).toBe("Updated biography from the admin proposal detail screen.");
    expect(JSON.parse(user.links_json ?? "[]")).toEqual(["https://example.test/speaker", "https://github.com/speaker"]);
    expect(speaker.role).toBe("moderator");
  });

  it("searches proposal and review text", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list-search");

    const response = await getEventProposals(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/proposals?q=relevance", {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { proposals: Array<{ title: string }>; pagination: { total: number } };
    expect(payload.proposals.map((proposal) => proposal.title)).toEqual(["Endpoint Proposal"]);
    expect(payload.pagination.total).toBe(1);
  });

  it("returns proposal detail with parsed answers and active form fields", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-detail");

    const response = await getProposalDetail(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}`, {
          headers: { authorization: `Bearer ${adminToken}` },
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

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-reviews");

    const response = await getProposalReviews(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          headers: { authorization: `Bearer ${adminToken}` },
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

  it("stores and returns internal proposal comments", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-comments");

    const addResponse = await addProposalComment(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/comments`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ comment: "Discuss **schedule fit** before final email." }),
        }),
        { proposalId },
      ),
    );

    expect(addResponse.status).toBe(200);
    const addPayload = (await addResponse.json()) as { comment: { comment: string; author_email: string } };
    expect(addPayload.comment.comment).toContain("schedule fit");
    expect(addPayload.comment.author_email).toBe("admin@pkic.org");

    const listResponse = await getProposalComments(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/comments`, {
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        { proposalId },
      ),
    );
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { comments: Array<{ comment: string }> };
    expect(listPayload.comments).toHaveLength(1);
    expect(listPayload.comments[0].comment).toBe("Discuss **schedule fit** before final email.");
  });

  it("refreshes the proposer manage token and returns a working manage URL", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-manage");

    const response = await openProposalManage(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/open-manage`, {
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}` },
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
