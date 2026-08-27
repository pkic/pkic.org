import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { AuthAdmin, DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import {
  adminProposalDetailResponseSchema,
  adminProposalSpeakerPatchResponseSchema,
  adminProposalSpeakersResponseSchema,
} from "../assets/shared/schemas/admin-event-proposals";
import app from "../functions/router";
import { onRequestGet as getProposalDetail } from "../functions/api/v1/admin/proposals/[proposalId]";
import { onRequestPost as openProposalManage } from "../functions/api/v1/admin/proposals/[proposalId]/open-manage";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { addProposalSpeaker, createProposal, getProposalByManageToken } from "../functions/_lib/services/proposals";
import { adminEventProposalsResponseSchema } from "../assets/shared/schemas/admin-event-proposals";
import {
  proposalCommentCreateResponseSchema,
  proposalCommentsListResponseSchema,
} from "../assets/shared/schemas/proposal-comments";
import { adminProposalPatchResponseSchema } from "../assets/shared/schemas/proposal-management";
import { proposalReviewsListResponseSchema } from "../assets/shared/schemas/proposal-reviews";
import { editAdminProposalSpeaker } from "../functions/_lib/services/proposal-speaker-admin";
import { buildAdminEventProposalsPageQuery } from "../functions/_lib/services/admin-event-proposals";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { editAdminProposal } from "../functions/_lib/services/proposal-admin-edit";
import { cancelAcceptedProposal } from "../functions/_lib/services/proposal-cancellation";
import { mutateBeforeNextBatch } from "./helpers/database-races";

const proposalDetails = {
  audience: "Operators",
  format: "panel",
  tracks: ["pki", "policy"],
  recordingConsent: true,
};

const proposalDetailsJson = JSON.stringify(proposalDetails);

/** Exercises the real router (auth middleware + openApiRoute query validation) for the proposals list endpoint. */
async function callAdminProposalsList(token: string, path: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalComments(
  token: string,
  proposalId: string,
  suffix = "",
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/comments${suffix}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init?.headers },
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalPatch(token: string, proposalId: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalDetail(token: string, proposalId: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalCancel(token: string, proposalId: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalReviews(token: string, proposalId: string, suffix = ""): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews${suffix}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function callAdminProposalSpeakers(
  token: string,
  proposalId: string,
  suffix = "",
  init?: RequestInit,
): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers${suffix}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init?.headers },
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

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
        details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
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
        'Strong deployment scope and relevance', 'Please include timing details', datetime('now'), datetime('now')
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

async function seedScopedProposalEditor(
  eventId: string,
  grantedByUserId: string,
  permissions: string[],
): Promise<{ actor: AuthAdmin; token: string; userId: string }> {
  const userId = crypto.randomUUID();
  const email = `proposal-editor-${userId}@example.test`;
  await env.DB.prepare(
    `INSERT INTO users (
       id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at
     ) VALUES (?, ?, ?, 'Proposal', 'Editor', 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email)
    .run();
  for (const permission of permissions) {
    await env.DB.prepare(
      `INSERT INTO permission_grants (
         id, user_id, permission, context_type, context_id, granted_by_user_id, created_at
       ) VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, permission, eventId, grantedByUserId)
      .run();
  }
  return {
    userId,
    token: await createAdminSession(env.DB, userId, `proposal-editor-token-${userId}`),
    actor: {
      identityType: "user",
      id: userId,
      email,
      role: "user",
      grants: permissions.map((permission) => ({ permission, contextType: "event", contextId: eventId })),
    },
  };
}

async function seedProposalSpeaker(
  proposalId: string,
  options: { status?: "pending" | "invited" | "confirmed" | "declined"; role?: string } = {},
): Promise<{ speakerId: string; proposalSpeakerId: string }> {
  const speakerId = crypto.randomUUID();
  const proposalSpeakerId = crypto.randomUUID();
  const email = `profile-speaker-${speakerId}@example.test`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (
           id, email, normalized_email, first_name, last_name, organization_name, job_title,
           biography, links_json, created_at, updated_at
         ) VALUES (?, ?, ?, 'Profile', 'Speaker', 'Old Org', 'Old Role', NULL, NULL, datetime('now'), datetime('now'))`,
    ).bind(speakerId, email, email),
    env.DB.prepare(
      `INSERT INTO proposal_speakers (
           id, proposal_id, user_id, role, status, manage_link_secret, created_at
         ) VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))`,
    ).bind(proposalSpeakerId, proposalId, speakerId, options.role ?? "speaker", options.status ?? "pending"),
  ]);
  return { speakerId, proposalSpeakerId };
}

describe("admin proposal endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("returns proposal list with proposer, review and decision metadata", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list");

    const response = await callAdminProposalsList(adminToken, "/api/v1/admin/events/pqc-2026/proposals");

    expect(response.status).toBe(200);
    const raw = (await response.json()) as { proposals: Array<Record<string, unknown>> };
    expect(raw.proposals[0]).not.toHaveProperty("manage_link_secret");
    expect(raw.proposals[0]).not.toHaveProperty("referral_code");
    const payload = adminEventProposalsResponseSchema.parse(raw);

    expect(payload.proposals.length).toBe(1);
    expect(payload.proposals[0].proposer_email).toBe("speaker@pkic.org");
    expect(Number(payload.proposals[0].review_count)).toBe(1);
    expect(Number(payload.proposals[0].average_review_score)).toBe(9);
    expect(Number(payload.proposals[0].recommendation_accept_count)).toBe(1);
    expect(payload.proposals[0].decision_status).toBe("accepted");
    expect(payload.page.total).toBe(1);
    expect(payload.page.hasMore).toBe(false);
    expect(payload.page.limit).toBe(50);
    expect(payload.page.offset).toBe(0);
    expect(payload.stats.byStatus.submitted).toBe(1);
    expect(payload.stats.byRecommendation.accept).toBe(1);
    expect(payload.stats.reviewedCount).toBe(1);
    expect(payload.stats.unreviewedCount).toBe(0);
    expect(payload.stats.total).toBe(1);
  });

  it("keeps proposal count predicates while excluding page-only review projections", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const query = buildAdminEventProposalsPageQuery({
      eventId,
      limit: 10,
      offset: 0,
      sort: "-submittedAt",
    });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);

    expect(pageSql).toMatch(/proposal_reviews|proposal_decisions/);
    expect(countSql).not.toMatch(/proposal_reviews|proposal_decisions|review_count|average_review_score/i);
    expect(countSql).toContain("sp.event_id = ?");
    expect(countBindings).toEqual([eventId]);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all(),
    ]);
    expect(pagePlan.results.length).toBeGreaterThan(0);
    expect(countPlan.results.length).toBeGreaterThan(0);

    const filteredQuery = buildAdminEventProposalsPageQuery({
      eventId,
      limit: 10,
      offset: 0,
      sort: "-submittedAt",
      status: "active",
      recommendation: "accept",
      q: "needle",
    });
    const filteredSql = buildOffsetPageSql(filteredQuery);
    expect(filteredSql.countSql).toContain("sp.status NOT IN");
    expect(filteredSql.countSql).toContain("pr_filter.recommendation = ?");
    expect(filteredSql.countSql).toContain("pr_search.proposal_id = sp.id");
    expect(filteredSql.countBindings).toEqual(filteredSql.bindings.slice(1));
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
          details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
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
    const scoreResponse = await callAdminProposalsList(
      adminToken,
      "/api/v1/admin/events/pqc-2026/proposals?sort=score",
    );
    const scorePayload = (await scoreResponse.json()) as { proposals: Array<{ title: string }> };
    expect(scorePayload.proposals.map((proposal) => proposal.title)).toEqual([
      "Lower Score Proposal",
      "Endpoint Proposal",
    ]);

    const filterResponse = await callAdminProposalsList(
      adminToken,
      "/api/v1/admin/events/pqc-2026/proposals?recommendation=reject",
    );
    const filterPayload = (await filterResponse.json()) as {
      proposals: Array<{ title: string; recommendation_reject_count: number }>;
      page: { total: number };
    };
    expect(filterPayload.proposals).toHaveLength(1);
    expect(filterPayload.proposals[0].title).toBe("Lower Score Proposal");
    expect(Number(filterPayload.proposals[0].recommendation_reject_count)).toBe(1);
    expect(filterPayload.page.total).toBe(1);
  });

  it("bounds the proposal list with limit/offset and reports a real total via page", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);
    const secondProposalId = crypto.randomUUID();
    const secondProposerId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, job_title, data_json, created_at, updated_at)
        VALUES ('${secondProposerId}', 'speaker-paged@pkic.org', 'speaker-paged@pkic.org', 'Speaker', 'Paged', 'Org', 'Role', NULL, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO session_proposals (
          id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          details_json, referral_code, manage_link_secret, submitted_at, updated_at, withdrawn_at
        ) VALUES (
          '${secondProposalId}', '${eventId}', '${secondProposerId}', 'submitted', 'talk', 'Second Page Proposal',
          'Another proposal abstract that is long enough to represent realistic content for testing.',
          NULL, NULL, 'hash-paged', datetime('now', '-1 minute'), datetime('now'), NULL
        )
      `),
    ]);

    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list-paged");
    const firstPageResponse = await callAdminProposalsList(
      adminToken,
      "/api/v1/admin/events/pqc-2026/proposals?status=submitted&limit=1&offset=0",
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPagePayload = (await firstPageResponse.json()) as {
      proposals: Array<{ title: string }>;
      page: { total: number; hasMore: boolean; limit: number; offset: number };
    };
    expect(firstPagePayload.proposals).toHaveLength(1);
    expect(firstPagePayload.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });

    const secondPageResponse = await callAdminProposalsList(
      adminToken,
      "/api/v1/admin/events/pqc-2026/proposals?status=submitted&limit=1&offset=1",
    );
    const secondPagePayload = (await secondPageResponse.json()) as {
      proposals: Array<{ title: string }>;
      page: { total: number; hasMore: boolean; limit: number; offset: number };
    };
    expect(secondPagePayload.proposals).toHaveLength(1);
    expect(secondPagePayload.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(secondPagePayload.proposals[0].title).not.toBe(firstPagePayload.proposals[0].title);
  });

  it("updates a proposal speaker profile including links", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-speaker-profile");

    const response = await callAdminProposalSpeakers(adminToken, proposalId, `/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Updated",
        lastName: "Speaker",
        organizationName: "PKIC Labs",
        jobTitle: "Moderator",
        biography: "Updated biography from the admin proposal detail screen.",
        links: ["https://example.test/speaker", "https://github.com/speaker"],
        role: "moderator",
      }),
    });

    expect(response.status).toBe(200);
    const payload = adminProposalSpeakerPatchResponseSchema.parse(await response.json());
    expect(payload.speaker).toMatchObject({
      userId: speakerId,
      firstName: "Updated",
      organizationName: "PKIC Labs",
      role: "moderator",
      links: ["https://example.test/speaker", "https://github.com/speaker"],
    });
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
    expect(user).toEqual({
      first_name: "Profile",
      organization_name: "Old Org",
      job_title: "Old Role",
      biography: null,
      links_json: null,
    });
    const [scoped] = await queryAll<{ profile_overrides_json: string }>(
      env.DB,
      "SELECT profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      [proposalId, speakerId],
    );
    expect(JSON.parse(scoped.profile_overrides_json)).toMatchObject({
      firstName: "Updated",
      organizationName: "PKIC Labs",
      jobTitle: "Moderator",
      biography: "Updated biography from the admin proposal detail screen.",
      links: ["https://example.test/speaker", "https://github.com/speaker"],
    });

    const second = await createProposal(env.DB, {
      eventId,
      proposerUserId: speakerId,
      proposalType: "talk",
      title: "Second proposal",
      abstract: "A separate proposal for the same account.",
    });
    await addProposalSpeaker(env.DB, {
      proposalId: second.proposal.id,
      userId: speakerId,
      role: "proposer",
    });
    const [secondSpeaker] = await queryAll<{ first_name: string | null; organization_name: string | null }>(
      env.DB,
      `SELECT u.first_name, u.organization_name
       FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id = ? AND ps.user_id = ?`,
      [second.proposal.id, speakerId],
    );
    expect(secondSpeaker).toEqual({ first_name: "Profile", organization_name: "Old Org" });
    expect(speaker.role).toBe("moderator");
  });

  it("returns the proposal speaker roster through its canonical response schema", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId, { status: "confirmed" });
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-speaker-roster");

    const response = await callAdminProposalSpeakers(adminToken, proposalId);

    expect(response.status).toBe(200);
    const payload = adminProposalSpeakersResponseSchema.parse(await response.json());
    expect(payload.summary).toMatchObject({ total: 1, confirmed: 1, pending: 0, declined: 0 });
    expect(payload.speakers[0]).toMatchObject({ userId: speakerId, role: "speaker", links: [] });
  });

  it("rejects an invalid proposal speaker role through the mounted shared schema", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-speaker-invalid-role");

    const response = await callAdminProposalSpeakers(adminToken, proposalId, `/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "keynote-emperor" }),
    });

    expect(response.status).toBe(400);
    const [speaker] = await queryAll<{ role: string }>(env.DB, "SELECT role FROM proposal_speakers WHERE user_id = ?", [
      speakerId,
    ]);
    expect(speaker.role).toBe("speaker");
  });

  it("rolls back every proposal speaker change when its audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-speaker-audit-rollback");
    await env.DB.prepare(
      `CREATE TRIGGER fail_admin_speaker_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'speaker_profile_updated'
       BEGIN
         SELECT RAISE(ABORT, 'forced speaker audit failure');
       END`,
    ).run();

    const response = await callAdminProposalSpeakers(adminToken, proposalId, `/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "Must Roll Back", role: "moderator" }),
    });
    await env.DB.prepare("DROP TRIGGER fail_admin_speaker_audit").run();

    expect(response.status).toBe(500);
    const [user] = await queryAll<{ first_name: string }>(env.DB, "SELECT first_name FROM users WHERE id = ?", [
      speakerId,
    ]);
    const [speaker] = await queryAll<{ role: string }>(env.DB, "SELECT role FROM proposal_speakers WHERE user_id = ?", [
      speakerId,
    ]);
    expect(user.first_name).toBe("Profile");
    expect(speaker.role).toBe("speaker");
  });

  it("rejects a stale proposal speaker plan without committing its profile, role, or audit fallout", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId);
    const baseDb: DatabaseLike = env.DB;
    let injectedChange = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!injectedChange) {
          injectedChange = true;
          await baseDb
            .prepare("UPDATE users SET first_name = 'Concurrent', updated_at = ? WHERE id = ?")
            .bind("2099-01-01T00:00:00.000Z", speakerId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      editAdminProposalSpeaker(
        racingDb,
        { identityType: "user", id: adminId, email: "admin@pkic.org", role: "admin" },
        proposalId,
        speakerId,
        { biography: "This stale biography must not be stored.", role: "moderator" },
        "https://app.test",
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    const [user] = await queryAll<{ first_name: string; biography: string | null }>(
      env.DB,
      "SELECT first_name, biography FROM users WHERE id = ?",
      [speakerId],
    );
    const [speaker] = await queryAll<{ role: string }>(env.DB, "SELECT role FROM proposal_speakers WHERE user_id = ?", [
      speakerId,
    ]);
    expect(user).toEqual({ first_name: "Concurrent", biography: null });
    expect(speaker.role).toBe("speaker");
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'speaker_profile_updated'"),
    ).resolves.toHaveLength(0);
  });

  it("keeps a declined speaker inactive when an admin changes the proposal role", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const { speakerId } = await seedProposalSpeaker(proposalId, { status: "declined" });
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-declined-speaker-role");
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted', updated_at = ? WHERE id = ?")
      .bind("2028-01-01T00:00:00.000Z", proposalId)
      .run();

    const response = await callAdminProposalSpeakers(adminToken, proposalId, `/${speakerId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "moderator" }),
    });

    expect(response.status).toBe(200);
    const participants = await queryAll<{ role: string; status: string }>(
      env.DB,
      `SELECT role, status FROM event_participant_role_sources
       WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker'
       ORDER BY role`,
      [eventId, speakerId],
    );
    expect(participants).toEqual([{ role: "moderator", status: "inactive" }]);
  });

  it("searches proposal and review text", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-list-search");

    const response = await callAdminProposalsList(adminToken, "/api/v1/admin/events/pqc-2026/proposals?q=relevance");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { proposals: Array<{ title: string }>; page: { total: number } };
    expect(payload.proposals.map((proposal) => proposal.title)).toEqual(["Endpoint Proposal"]);
    expect(payload.page.total).toBe(1);
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
    const rawPayload = await response.json();
    const payload = adminProposalDetailResponseSchema.parse(rawPayload);

    expect(payload.proposal.details).toEqual(proposalDetails);
    expect(rawPayload).not.toHaveProperty("proposal.manage_link_secret");
    expect(rawPayload).not.toHaveProperty("proposal.manage_token_hash");
    expect(rawPayload).not.toHaveProperty("proposal.referral_code");
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

    const response = await callAdminProposalReviews(adminToken, proposalId);

    expect(response.status).toBe(200);
    const payload = proposalReviewsListResponseSchema.parse(await response.json());

    expect(payload.reviews.length).toBe(1);
    expect(payload.reviews[0].reviewer_email).toBe("admin@pkic.org");
    expect(payload.reviews[0].reviewer_first_name ?? null).toBeNull();
    expect(payload.summary).toMatchObject({ totalReviews: 1, acceptCount: 1, quorumMet: false });
    expect(payload.page).toEqual({ limit: 25, offset: 0, total: 1, hasMore: false });
  });

  it("searches and paginates reviews in D1 while returning unfiltered proposal aggregates", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const secondReviewerId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
           VALUES (?, 'second-reviewer@pkic.org', 'second-reviewer@pkic.org', 'Second', 'admin', 1, datetime('now'), datetime('now'))`,
      ).bind(secondReviewerId),
      env.DB.prepare(
        `INSERT INTO proposal_reviews (
             id, proposal_id, reviewer_user_id, recommendation, score,
             reviewer_comment, applicant_note, created_at, updated_at
           ) VALUES (?, ?, ?, 'reject', 7, 'Different deployment concern', NULL, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), proposalId, secondReviewerId),
    ]);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-review-query");

    const response = await callAdminProposalReviews(
      adminToken,
      proposalId,
      "?limit=1&offset=1&q=deployment&sort=-score",
    );

    expect(response.status).toBe(200);
    const payload = proposalReviewsListResponseSchema.parse(await response.json());
    expect(payload.reviews.map((review) => review.reviewer_email)).toEqual(["second-reviewer@pkic.org"]);
    expect(payload.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(payload.myReview?.reviewer_user_id).toBe(adminId);
    expect(payload.summary).toEqual({
      totalReviews: 2,
      averageScore: 8,
      acceptCount: 1,
      needsWorkCount: 0,
      rejectCount: 1,
      minReviewsRequired: 2,
      quorumMet: true,
    });
  });

  it("stores and returns internal proposal comments", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-comments");

    const addResponse = await callAdminProposalComments(adminToken, proposalId, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "Discuss **schedule fit** before final email." }),
    });

    expect(addResponse.status).toBe(200);
    const addPayload = proposalCommentCreateResponseSchema.parse(await addResponse.json());
    expect(addPayload.comment.comment).toContain("schedule fit");
    expect(addPayload.comment.author_email).toBe("admin@pkic.org");

    const listResponse = await callAdminProposalComments(adminToken, proposalId, "?limit=1&q=schedule");
    expect(listResponse.status).toBe(200);
    const listPayload = proposalCommentsListResponseSchema.parse(await listResponse.json());
    expect(listPayload.comments).toHaveLength(1);
    expect(listPayload.comments[0].comment).toBe("Discuss **schedule fit** before final email.");
    expect(listPayload.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'proposal_internal_comment_added'",
    );
    expect(JSON.parse(audit.details_json)).toEqual({ commentId: { from: null, to: addPayload.comment.id } });

    const secondAddResponse = await callAdminProposalComments(adminToken, proposalId, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "A second internal note." }),
    });
    expect(secondAddResponse.status).toBe(200);
    const firstPage = proposalCommentsListResponseSchema.parse(
      await (await callAdminProposalComments(adminToken, proposalId, "?limit=1")).json(),
    );
    expect(firstPage.comments).toHaveLength(1);
    expect(firstPage.page).toEqual({ limit: 1, offset: 0, total: 2, hasMore: true });
  });

  it("keeps API-key comment reads available but rejects unattributable comment creation", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithReviews(env.DB, eventId);
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";

    expect((await callAdminProposalComments(apiKey, proposalId)).status).toBe(200);
    const response = await callAdminProposalComments(apiKey, proposalId, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "This must not be stored without a user identity." }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_internal_comments WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_internal_comment_added'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back a proposal comment when its audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-comment-rollback");
    await env.DB.prepare(
      `CREATE TRIGGER fail_proposal_comment_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'proposal_internal_comment_added'
         BEGIN
           SELECT RAISE(ABORT, 'forced audit failure');
         END`,
    ).run();

    const response = await callAdminProposalComments(adminToken, proposalId, "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ comment: "This must roll back." }),
    });

    expect(response.status).toBe(500);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_internal_comments WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
  });

  it("atomically edits proposal text and records only changed fields", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-proposal-edit");

    const response = await callAdminProposalPatch(adminToken, proposalId, { title: "Updated Endpoint Proposal" });
    expect(response.status).toBe(200);
    const payload = adminProposalPatchResponseSchema.parse(await response.json());
    expect(payload.proposal.title).toBe("Updated Endpoint Proposal");
    const [audit] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE action = 'proposal_edited'",
    );
    expect(JSON.parse(audit.details_json)).toEqual({
      title: { from: "Endpoint Proposal", to: "Updated Endpoint Proposal" },
    });
  });

  it("lets the narrow event capability update only an accepted abstract", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const editor = await seedScopedProposalEditor(eventId, adminId, ["proposals:edit_accepted_abstract"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();

    const response = await callAdminProposalPatch(editor.token, proposalId, {
      abstract:
        "The accepted abstract was corrected by the program committee to explain the operational scope, expected audience, and concrete outcomes in enough detail.",
    });

    expect(response.status).toBe(200);
    const payload = adminProposalPatchResponseSchema.parse(await response.json());
    expect(payload.proposal.abstract).toContain("corrected by the program committee");
    expect(payload.proposal.title).toBe("Endpoint Proposal");
  });

  it("does not let the accepted-abstract capability change an accepted title", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const editor = await seedScopedProposalEditor(eventId, adminId, ["proposals:edit_accepted_abstract"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();

    const response = await callAdminProposalPatch(editor.token, proposalId, { title: "Changed accepted title" });

    expect(response.status).toBe(403);
  });

  it("keeps accepted titles manageable while reserving accepted abstracts for the narrow capability", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const manager = await seedScopedProposalEditor(eventId, adminId, ["proposals:manage"]);
    const acceptedEditor = await seedScopedProposalEditor(eventId, adminId, ["proposals:edit_accepted_abstract"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();

    expect(
      (
        await callAdminProposalPatch(manager.token, proposalId, {
          abstract:
            "Manage alone must not override acceptance by changing an accepted abstract without the explicit event-scoped capability required for that operation.",
        })
      ).status,
    ).toBe(403);
    expect(
      (await callAdminProposalPatch(manager.token, proposalId, { title: "Corrected accepted title" })).status,
    ).toBe(200);

    await env.DB.prepare("UPDATE session_proposals SET status = 'submitted' WHERE id = ?").bind(proposalId).run();
    expect(
      (
        await callAdminProposalPatch(acceptedEditor.token, proposalId, {
          abstract:
            "The narrow accepted-abstract permission is intentionally not a general proposal editor and cannot modify an ordinary submitted proposal at this stage.",
        })
      ).status,
    ).toBe(403);
  });

  it("rolls back accepted abstract edits when the capability is revoked before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const editor = await seedScopedProposalEditor(eventId, adminId, ["proposals:edit_accepted_abstract"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?")
        .bind(editor.userId)
        .run(),
    );

    await expect(
      editAdminProposal(racingDb, editor.actor, proposalId, { abstract: "This edit must roll back." }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_AUTHORIZATION_CHANGED" });
    const [proposal] = await queryAll<{ abstract: string }>(
      env.DB,
      "SELECT abstract FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposal.abstract).toContain("realistic content");
    await expect(queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_edited'")).resolves.toHaveLength(
      0,
    );
  });

  it("does not apply an accepted abstract edit after the proposal status changes", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const editor = await seedScopedProposalEditor(eventId, adminId, ["proposals:edit_accepted_abstract"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = ? WHERE id = ?")
        .bind("2099-01-01T00:00:00.000Z", proposalId)
        .run(),
    );

    await expect(
      editAdminProposal(racingDb, editor.actor, proposalId, { abstract: "This stale edit must not win." }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_EDIT_CONFLICT" });
    const [proposal] = await queryAll<{ status: string; abstract: string }>(
      env.DB,
      "SELECT status, abstract FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposal.status).toBe("rejected");
    expect(proposal.abstract).toContain("realistic content");
  });

  it("cancels an accepted proposal with a comment while preserving its accepted decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const editor = await seedScopedProposalEditor(eventId, adminId, ["proposals:cancel_accepted"]);
    const adminToken = await createAdminSession(env.DB, adminId, `proposal-cancellation-read-${proposalId}`);
    await seedProposalSpeaker(proposalId, { status: "confirmed" });
    await seedProposalSpeaker(proposalId, { status: "invited" });
    await seedProposalSpeaker(proposalId, { status: "declined" });
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    await env.DB.prepare(
      `INSERT INTO proposal_decision_history (
         id, proposal_id, review_round, decided_by_user_id, final_status, decision_note,
         min_reviews_required, review_count, decided_at, decision_sequence
       )
       SELECT id, proposal_id, review_round, decided_by_user_id, final_status, decision_note,
              min_reviews_required, review_count, decided_at, decision_sequence
         FROM proposal_decisions WHERE proposal_id = ?`,
    )
      .bind(proposalId)
      .run();

    const response = await callAdminProposalCancel(editor.token, proposalId, {
      comment: "The speaker is unavailable; [untrusted link](https://example.invalid).",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      proposalId,
      status: "canceled",
      notifiedSpeakerCount: 3,
    });
    const [proposal] = await queryAll<{
      status: string;
      cancellation_comment: string;
      canceled_by_user_id: string;
    }>(env.DB, "SELECT status, cancellation_comment, canceled_by_user_id FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(proposal).toEqual({
      status: "canceled",
      cancellation_comment: "The speaker is unavailable; [untrusted link](https://example.invalid).",
      canceled_by_user_id: editor.userId,
    });
    await expect(
      queryAll(env.DB, "SELECT final_status FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toEqual([{ final_status: "accepted" }]);
    await expect(
      queryAll(env.DB, "SELECT final_status FROM proposal_decision_history WHERE proposal_id = ?", [proposalId]),
    ).resolves.toEqual([{ final_status: "accepted" }]);
    const outbox = await queryAll<{ template_key: string; payload_json: string }>(
      env.DB,
      "SELECT template_key, payload_json FROM email_outbox WHERE idempotency_key LIKE 'proposal-canceled:%'",
    );
    expect(outbox).toHaveLength(3);
    expect(outbox.every((row) => row.template_key === "proposal_canceled")).toBe(true);
    expect(JSON.parse(outbox[0].payload_json).cancellationCommentText).toContain("\\[untrusted link\\]");

    const detailResponse = await callAdminProposalDetail(adminToken, proposalId);
    expect(detailResponse.status).toBe(200);
    const detail = adminProposalDetailResponseSchema.parse(await detailResponse.json());
    expect(detail.proposal.status).toBe("canceled");
    expect(detail.proposal.decision_status).toBe("accepted");
    expect(detail.proposal.cancellation_comment).toContain("speaker is unavailable");

    const listResponse = await callAdminProposalsList(
      adminToken,
      "/api/v1/admin/events/pqc-2026/proposals?status=canceled",
    );
    expect(listResponse.status).toBe(200);
    const list = adminEventProposalsResponseSchema.parse(await listResponse.json());
    expect(list.proposals).toHaveLength(1);
    expect(list.proposals[0]).toMatchObject({ id: proposalId, status: "canceled", decision_status: "accepted" });
  });

  it("requires the cancellation capability and a non-empty comment", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const manager = await seedScopedProposalEditor(eventId, adminId, ["proposals:manage"]);
    const canceler = await seedScopedProposalEditor(eventId, adminId, ["proposals:cancel_accepted"]);
    const otherEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (
         id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee,
         settings_json, created_at, updated_at
       ) VALUES (?, ?, 'Other Event', 'UTC', '2027-01-01T09:00:00.000Z', '2027-01-01T17:00:00.000Z',
                 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(otherEventId, `other-${otherEventId}`)
      .run();
    const wrongEventCanceler = await seedScopedProposalEditor(otherEventId, adminId, ["proposals:cancel_accepted"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();

    expect((await callAdminProposalCancel(manager.token, proposalId, { comment: "Unavailable" })).status).toBe(403);
    expect((await callAdminProposalCancel(canceler.token, proposalId, { comment: "   " })).status).toBe(400);
    expect(
      (await callAdminProposalCancel(wrongEventCanceler.token, proposalId, { comment: "Wrong event" })).status,
    ).toBe(403);
  });

  it("rolls back accepted-proposal cancellation when its permission is revoked before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const canceler = await seedScopedProposalEditor(eventId, adminId, ["proposals:cancel_accepted"]);
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?")
        .bind(canceler.userId)
        .run(),
    );

    await expect(
      cancelAcceptedProposal(racingDb, canceler.actor, proposalId, "Speaker unavailable", "https://app.test"),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CANCELLATION_AUTHORIZATION_CHANGED" });
    await expect(queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId])).resolves.toEqual([
      { status: "accepted" },
    ]);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'proposal-canceled:%'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back accepted-proposal cancellation when the speaker roster changes before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const canceler = await seedScopedProposalEditor(eventId, adminId, ["proposals:cancel_accepted"]);
    await seedProposalSpeaker(proposalId, { status: "confirmed" });
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await seedProposalSpeaker(proposalId, { status: "invited" });
    });

    await expect(
      cancelAcceptedProposal(racingDb, canceler.actor, proposalId, "Speaker unavailable", "https://app.test"),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CANCELLATION_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId])).resolves.toEqual([
      { status: "accepted" },
    ]);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'proposal-canceled:%'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back cancellation state and notifications when its audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const canceler = await seedScopedProposalEditor(eventId, adminId, ["proposals:cancel_accepted"]);
    await seedProposalSpeaker(proposalId, { status: "confirmed" });
    await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposalId).run();
    await env.DB.prepare(
      `CREATE TRIGGER fail_proposal_cancellation_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'accepted_proposal_canceled'
         BEGIN SELECT RAISE(ABORT, 'forced cancellation audit failure'); END`,
    ).run();

    await expect(
      cancelAcceptedProposal(env.DB, canceler.actor, proposalId, "Speaker unavailable", "https://app.test"),
    ).rejects.toThrow("forced cancellation audit failure");
    await expect(
      queryAll(env.DB, "SELECT status, canceled_at FROM session_proposals WHERE id = ?", [proposalId]),
    ).resolves.toEqual([{ status: "accepted", canceled_at: null }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'proposal-canceled:%'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back a proposal edit when its audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-proposal-edit-rollback");
    await env.DB.prepare(
      `CREATE TRIGGER fail_proposal_edit_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'proposal_edited'
         BEGIN
           SELECT RAISE(ABORT, 'forced audit failure');
         END`,
    ).run();

    const response = await callAdminProposalPatch(adminToken, proposalId, { title: "Must Roll Back" });
    expect(response.status).toBe(500);
    const [proposal] = await queryAll<{ title: string }>(env.DB, "SELECT title FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(proposal.title).toBe("Endpoint Proposal");
  });

  it("rejects an empty proposal edit through the mounted shared schema", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminId } = await seedProposalWithReviews(env.DB, eventId);
    const adminToken = await createAdminSession(env.DB, adminId, "token-admin-proposal-edit-empty");

    const response = await callAdminProposalPatch(adminToken, proposalId, {});
    expect(response.status).toBe(400);
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

    const proposal = await getProposalByManageToken(env.DB, token!, "test-signing-secret");
    expect(proposal.id).toBe(proposalId);
  });
});
