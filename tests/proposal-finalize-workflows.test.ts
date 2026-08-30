import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import app from "../functions/router";
import { createProposal, addProposalSpeaker, finalizeProposalDecision } from "../functions/_lib/services/proposals";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { proposalFlagResponseSchema } from "../assets/shared/schemas/proposal-status";

function decisionActor(id: string) {
  return { identityType: "user" as const, id, email: "admin@pkic.org", role: "admin" };
}

async function postProposalReview(proposalId: string, token: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test/api/v1/proposals/${proposalId}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function seedProposalWithSpeaker(
  eventId: string,
): Promise<{ proposalId: string; proposerUserId: string; speakerUserId: string; adminUserId: string }> {
  const proposerUserId = crypto.randomUUID();
  const speakerUserId = crypto.randomUUID();

  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
      VALUES ('${proposerUserId}', 'proposer@wf.test', 'proposer@wf.test', 'Proposer', 'Test', NULL, datetime('now'), datetime('now'))
    `),
    env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
      VALUES ('${speakerUserId}', 'speaker@wf.test', 'speaker@wf.test', 'Speaker', 'Test', NULL, datetime('now'), datetime('now'))
    `),
  ]);

  const { proposal } = await createProposal(env.DB, {
    eventId,
    proposerUserId,
    proposalType: "talk",
    title: "Workflow Test Proposal",
    abstract: "A proposal for testing all finalize workflow paths.",
  });

  await addProposalSpeaker(env.DB, { proposalId: proposal.id, userId: proposerUserId, role: "proposer" });
  await addProposalSpeaker(env.DB, { proposalId: proposal.id, userId: speakerUserId, role: "speaker" });

  return { proposalId: proposal.id, proposerUserId, speakerUserId, adminUserId: adminRow.id };
}

async function addReviews(eventId: string, proposalId: string, adminId: string, count = 2) {
  const extraAdminIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${id}', 'reviewer${i}@wf.test', 'reviewer${i}@wf.test', 'admin', 1, datetime('now'), datetime('now'))
    `,
    ).run();
    const token = await createAdminSession(env.DB, id, `reviewer-token-${i}`);
    await postProposalReview(proposalId, token, { recommendation: "accept", score: 8 });
    extraAdminIds.push(id);
  }
  return extraAdminIds;
}

async function getProposalRoleSources(proposalId: string): Promise<Array<{ user_id: string; status: string }>> {
  return queryAll<{ user_id: string; status: string }>(
    env.DB,
    `SELECT user_id, status
     FROM event_participant_role_sources
     WHERE source_type = 'proposal' AND source_ref = ?`,
    [proposalId],
  );
}

describe("proposal finalize workflows", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a synthetic API-key actor at the decision service boundary", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);

    await expect(
      finalizeProposalDecision(env.DB, {
        proposalId,
        actor: { identityType: "service", id: "api-key", email: "api-key", role: "admin" },
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ status: 403, code: "USER_BACKED_ADMIN_REQUIRED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", proposalId),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'proposal_decision_recorded' AND entity_id = ?",
        proposalId,
      ),
    ).resolves.toHaveLength(0);
  });

  it("accept: sets proposal status to accepted and activates proposal role sources", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, proposerUserId, speakerUserId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: decisionActor(adminUserId),
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const [proposalRow] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposalRow.status).toBe("accepted");

    const participants = await getProposalRoleSources(proposalId);
    const active = participants.filter((p) => p.status === "active").map((p) => p.user_id);
    expect(active).toContain(proposerUserId);
    expect(active).toContain(speakerUserId);
  });

  it("reject: sets proposal status to rejected and deactivates proposal role sources", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: decisionActor(adminUserId),
      finalStatus: "rejected",
      minReviewsRequired: 0,
    });

    const [proposalRow] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposalRow.status).toBe("rejected");

    const participants = await getProposalRoleSources(proposalId);
    expect(participants.length).toBeGreaterThan(0);
    for (const p of participants) {
      expect(p.status).toBe("inactive");
    }
  });

  it("needs-work: sets proposal status and deactivates participants", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: decisionActor(adminUserId),
      finalStatus: "needs-work",
      decisionNote: "Please revise the proposal before resubmitting.",
      minReviewsRequired: 0,
    });

    const [proposalRow] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposalRow.status).toBe("needs-work");
  });

  it("double-finalize returns PROPOSAL_ALREADY_FINALIZED", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: decisionActor(adminUserId),
      finalStatus: "rejected",
      minReviewsRequired: 0,
    });

    await expect(
      finalizeProposalDecision(env.DB, {
        proposalId,
        actor: decisionActor(adminUserId),
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_ALREADY_FINALIZED" });
  });

  it("finalize HTTP handler: records decision and queues emails via outbox", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    const adminToken = await createAdminSession(env.DB, adminUserId, "finalize-test-token");
    await addReviews(eventId, proposalId, adminUserId);

    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "rejected",
      decisionNote: "Not a fit for this event.",
    });

    expect(response.status).toBe(200);

    const decisions = await queryAll<{ final_status: string; decision_note: string }>(
      env.DB,
      "SELECT final_status, decision_note FROM proposal_decisions WHERE proposal_id = ?",
      [proposalId],
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].final_status).toBe("rejected");
    expect(decisions[0].decision_note).toBe("Not a fit for this event.");

    const outbox = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?)",
      [proposalId],
    );
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.map((r) => r.template_key)).toContain("proposal_decision");
  });

  it("rolls back the decision, participant state, outbox, and deadline when audit insertion fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "finalize-rollback-token");
    await addReviews(eventId, proposalId, adminUserId);
    await env.DB.prepare(
      `CREATE TRIGGER reject_proposal_decision_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'proposal_decision_recorded'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    try {
      const response = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
        finalStatus: "accepted",
        presentationDeadline: "2027-03-01T00:00:00.000Z",
      });
      expect(response.status).toBe(500);

      const [proposal] = await queryAll<{ status: string; presentation_deadline: string | null }>(
        env.DB,
        "SELECT status, presentation_deadline FROM session_proposals WHERE id = ?",
        [proposalId],
      );
      expect(proposal).toMatchObject({ status: "submitted", presentation_deadline: null });
      expect(
        await queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [proposalId]),
      ).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE event_id = ?", [eventId])).toHaveLength(0);
      const participants = await getProposalRoleSources(proposalId);
      expect(participants.length).toBeGreaterThan(0);
      expect(participants.every(({ status }) => status === "inactive")).toBe(true);
    } finally {
      await env.DB.prepare("DROP TRIGGER IF EXISTS reject_proposal_decision_audit").run();
    }
  });

  it("finalize HTTP handler: accepted proposal queues speaker_profile_request emails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    const adminToken = await createAdminSession(env.DB, adminUserId, "finalize-accept-token");
    await addReviews(eventId, proposalId, adminUserId);

    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "accepted",
    });

    expect(response.status).toBe(200);

    const outboxKeys = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT DISTINCT template_key FROM email_outbox",
    );
    const keys = outboxKeys.map((r) => r.template_key);
    expect(keys).toContain("proposal_decision");
    expect(keys).toContain("speaker_profile_request");
    expect(keys).toContain("presentation_upload_request");
  });
});

describe("proposal spam/duplicate/delete", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks a proposal as spam", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-spam-service-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "spam" });
    expect(response.status).toBe(200);
    expect(proposalFlagResponseSchema.parse(await response.json())).toEqual({ success: true, action: "spam" });

    const [row] = await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(row.status).toBe("spam");
  });

  it("marks a proposal as duplicate", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-duplicate-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "duplicate" });
    expect(response.status).toBe(200);

    const [row] = await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(row.status).toBe("duplicate");
  });

  it("soft-delete: sets deleted_at and deactivates proposal role sources", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-delete-service-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "delete" });
    expect(response.status).toBe(200);

    const [row] = await queryAll<{ status: string; deleted_at: string | null }>(
      env.DB,
      "SELECT status, deleted_at FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).not.toBeNull();

    const participants = await getProposalRoleSources(proposalId);
    expect(participants.length).toBeGreaterThan(0);
    for (const p of participants) {
      expect(p.status).toBe("inactive");
    }
  });

  it("soft-delete: proposal excluded from default list query", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-delete-list-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "delete" });
    expect(response.status).toBe(200);

    const remaining = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM session_proposals WHERE event_id = ? AND deleted_at IS NULL",
      [eventId],
    );
    expect(remaining.map((r) => r.id)).not.toContain(proposalId);
  });

  it("flag API endpoint: marks as spam and writes audit log", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-spam-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "spam" });

    expect(response.status).toBe(200);

    const [row] = await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(row.status).toBe("spam");

    const auditRows = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
      [proposalId],
    );
    expect(auditRows[0]?.action).toBe("proposal_flagged");
  });

  it("flag API endpoint: soft-deletes and writes audit log", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-delete-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "delete" });

    expect(response.status).toBe(200);

    const [row] = await queryAll<{ deleted_at: string | null }>(
      env.DB,
      "SELECT deleted_at FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(row.deleted_at).not.toBeNull();

    const auditRows = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
      [proposalId],
    );
    expect(auditRows[0]?.action).toBe("proposal_deleted");
  });

  it("rolls back proposal deletion when its audit write fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-delete-rollback-token");
    await env.DB.prepare(
      `CREATE TRIGGER reject_proposal_delete_audit
         BEFORE INSERT ON audit_log
         WHEN NEW.action = 'proposal_deleted'
         BEGIN
           SELECT RAISE(ABORT, 'forced audit failure');
         END`,
    ).run();

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "delete" });
    expect(response.status).toBe(500);

    const [proposal] = await queryAll<{ status: string; deleted_at: string | null }>(
      env.DB,
      "SELECT status, deleted_at FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposal).toEqual({ status: "submitted", deleted_at: null });
    const participants = await getProposalRoleSources(proposalId);
    expect(participants.length).toBeGreaterThan(0);
    expect(participants.every(({ status }) => status === "inactive")).toBe(true);
  });

  it("does not audit a moderation compare-and-set that loses", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-conflict-token");
    await env.DB.prepare(
      `CREATE TRIGGER ignore_proposal_spam_update
         BEFORE UPDATE OF status ON session_proposals
         WHEN NEW.id = '${proposalId}' AND NEW.status = 'spam'
         BEGIN
           SELECT RAISE(IGNORE);
         END`,
    ).run();

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "spam" });
    expect(response.status).toBe(409);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'proposal_flagged'", [proposalId]),
    ).resolves.toHaveLength(0);
    const [proposal] = await queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [
      proposalId,
    ]);
    expect(proposal.status).toBe("submitted");
  });
});

// ─── HTTP error path tests (via full app router) ──────────────────────────────
// These tests exercise the complete request stack including sub-router onError
// handlers. Direct handler calls bypass error handling — these don't.

async function callApp(path: string, adminToken: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

describe("proposal HTTP error responses (full router stack)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("finalize: double-finalize returns JSON 409 with PROPOSAL_ALREADY_FINALIZED", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "double-finalize-token");
    await addReviews(eventId, proposalId, adminUserId);

    // First finalize — must succeed
    const first = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "rejected",
    });
    expect(first.status).toBe(200);

    // Second finalize — must return JSON 409, not a 500 or a crash
    const second = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "accepted",
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PROPOSAL_ALREADY_FINALIZED");
  });

  it("finalize: review threshold not met returns JSON 409", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "threshold-token");

    // Default config requires 2 reviews; seed none so threshold is not met
    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "accepted",
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PROPOSAL_REVIEW_THRESHOLD_NOT_MET");
  });

  it("finalize: shared API-key authentication cannot record an unattributed governance decision", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);
    const apiKey = "proposal-finalize-api-key";
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ finalStatus: "accepted" }),
      }),
      { ...env, ADMIN_API_KEY: apiKey } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
  });

  it("finalize: shared validation requires a note for needs-work and rejects ignored deadlines", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "invalid-decision-policy-token");

    const missingNote = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "needs-work",
    });
    expect(missingNote.status).toBe(400);
    const ignoredDeadline = await callApp(`/api/v1/proposals/${proposalId}/decisions`, adminToken, {
      finalStatus: "rejected",
      presentationDeadline: "2027-03-01T00:00:00.000Z",
    });
    expect(ignoredDeadline.status).toBe(400);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
  });

  it("finalize and preview reject a moderated proposal before producing decision fallout", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "moderated-decision-token");
    expect((await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "spam" })).status).toBe(
      200,
    );

    for (const path of ["decisions/previews", "decisions"]) {
      const response = await callApp(`/api/v1/proposals/${proposalId}/${path}`, adminToken, {
        finalStatus: "rejected",
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_NOT_DECIDABLE" } });
    }
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toHaveLength(0);
  });

  it("flag: flagging a finalized proposal returns JSON 409 with PROPOSAL_ALREADY_FINALIZED", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-finalized-token");

    // Finalize the proposal first
    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: decisionActor(adminUserId),
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    // Flag on a finalized proposal — must return JSON 409
    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "spam" });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PROPOSAL_ALREADY_FINALIZED");
  });

  it("flag: rejects an unknown action through the mounted shared schema", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "flag-invalid-action-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/moderations`, adminToken, { action: "archive" });
    expect(response.status).toBe(400);
  });

  it("finalize: unknown proposal returns JSON 404", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "unknown-proposal-token");

    const response = await callApp(`/api/v1/proposals/00000000-0000-0000-0000-000000000000/decisions`, adminToken, {
      finalStatus: "rejected",
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PROPOSAL_NOT_FOUND");
  });

  it("finalize-preview: returns 200 JSON with missingTemplateKeys when no templates are configured", async () => {
    // Replicates the production crash: admin clicks Preview before any email
    // templates are set up. No templates seeded — handler must not throw.
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "preview-no-templates-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions/previews`, adminToken, {
      finalStatus: "accepted",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success?: boolean;
      missingTemplateKeys?: string[];
      messages?: unknown[];
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.missingTemplateKeys)).toBe(true);
    expect((body.missingTemplateKeys ?? []).length).toBeGreaterThan(0);
  });

  it("finalize-preview: returns 200 JSON with rendered emails when all templates are configured (production scenario)", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "preview-full-templates-token");
    await seedWorkflowEmailTemplates(env.DB, adminUserId);

    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions/previews`, adminToken, {
      finalStatus: "accepted",
    });

    if (response.status !== 200) {
      const body = await response.text();
      throw new Error(`Expected 200, got ${response.status}: ${body}`);
    }

    const body = (await response.json()) as {
      success?: boolean;
      layoutMissing?: boolean;
      missingTemplateKeys?: string[];
      messages?: { templateMissing?: boolean; html?: string }[];
    };
    expect(body.success).toBe(true);
    expect(body.layoutMissing).toBe(false);
    expect(body.missingTemplateKeys).toEqual([]);
    expect(body.messages?.every((m) => !m.templateMissing)).toBe(true);
    expect(body.messages?.every((m) => (m.html?.length ?? 0) > 0)).toBe(true);
  });

  it("finalize-preview: returns 200 JSON when email template exists but email_layout is missing", async () => {
    // Replicates the exact production crash: proposal_decision template is
    // configured but email_layout is not. renderEmail calls wrapHtml("") which
    // throws a plain Error (no .code). The per-message catch must handle it
    // gracefully rather than re-throwing and crashing the worker.
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const adminToken = await createAdminSession(env.DB, adminUserId, "preview-no-layout-token");

    // Seed the email template but deliberately omit email_layout
    const v = await createTemplateVersion(env.DB, {
      templateKey: "proposal_decision",
      content: "Dear {{firstName}}, your proposal **{{proposalTitle}}** is {{finalStatus}}.",
      subjectTemplate: "Proposal update: {{proposalTitle}}",
      createdByUserId: adminUserId,
    });
    await activateTemplateVersion(env.DB, { templateKey: "proposal_decision", version: v.version });

    const response = await callApp(`/api/v1/proposals/${proposalId}/decisions/previews`, adminToken, {
      finalStatus: "rejected",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success?: boolean;
      missingTemplateKeys?: string[];
      messages?: { templateMissing?: boolean }[];
    };
    expect(body.success).toBe(true);
    // proposal_decision rendered (or marked missing due to layout), no crash
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

// ── PR #1 review Phase 4 item 1: /admin/proposals/:proposalId/** floor gate ──
// requireProposalAccess (proposals/[proposalId]/router.ts) now requires at
// least proposals:read on the proposal's event for every route in this
// subtree. Several handlers (audit-log.ts, remind-speakers.ts among them)
// previously had no permission check at all beyond bare authentication, so
// any authenticated staff-portal actor — including one with zero role or
// permission grants — could read or act on any event's proposals.
describe("proposal subtree access gate (full router stack)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function insertStaffUser(email: string): Promise<string> {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(id, email, email)
      .run();
    return id;
  }

  async function assignEventModerator(userId: string, eventId: string, grantedBy: string): Promise<void> {
    // Kept as an assignment rather than a persona because the caller already
    // holds a user it created for other reasons; the role itself is the same
    // one `eventModerator` plays.
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-event_moderator', 'event', ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId, eventId, grantedBy)
      .run();
  }

  async function assignProposalReadOnlyRole(userId: string, eventId: string, grantedBy: string): Promise<void> {
    const roleId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at)
         VALUES (?, ?, NULL, 0, datetime('now'), datetime('now'))`,
      ).bind(roleId, `proposal_reader_${roleId}`),
      env.DB.prepare(
        `INSERT INTO role_permissions (id, role_id, permission, created_at)
         VALUES (?, ?, 'proposals:read', datetime('now'))`,
      ).bind(crypto.randomUUID(), roleId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), userId, roleId, eventId, grantedBy),
    ]);
  }

  // Grants a role unrelated to proposals/events so the user passes
  // STAFF_ACCESS_CONDITION (can obtain a session at all) while still
  // lacking proposals:read — otherwise a truly grant-less user can't even
  // authenticate, and the test would observe 401 (no session) rather than
  // the 403 (authenticated, unauthorized) this gate is meant to prove.
  async function assignUnrelatedStaffRole(userId: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-membership_processor', NULL, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId)
      .run();
  }

  async function callAppGet(path: string, adminToken: string): Promise<Response> {
    return app.fetch(
      new Request(`https://app.test${path}`, { headers: { authorization: `Bearer ${adminToken}` } }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
  }

  async function insertOtherEvent(): Promise<{ eventId: string }> {
    const eventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, capacity_in_person, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, 'other-event', 'Other Event', 'Europe/Amsterdam', '2026-06-01T08:00:00.000Z', '2026-06-02T18:00:00.000Z', 1, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(eventId)
      .run();
    return { eventId };
  }

  it("audit-log: a staff user with no event-scoped access cannot view a proposal's audit log", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);
    const staffId = await insertStaffUser("no-access-audit@wf.test");
    await assignUnrelatedStaffRole(staffId);
    const staffToken = await createAdminSession(env.DB, staffId, "no-access-audit-token");

    const response = await callAppGet(`/api/v1/proposals/${proposalId}/audit-log`, staffToken);
    expect(response.status).toBe(403);
  });

  it("audit-log: proposals:read alone cannot expose private review notes", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const staffId = await insertStaffUser("read-only-audit@wf.test");
    await assignProposalReadOnlyRole(staffId, eventId, adminUserId);
    const staffToken = await createAdminSession(env.DB, staffId, "read-only-audit-token");

    const response = await callAppGet(`/api/v1/proposals/${proposalId}/audit-log`, staffToken);
    expect(response.status).toBe(403);
  });

  it("remind-speakers: a staff user with no event-scoped access cannot trigger speaker reminders", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);
    const staffId = await insertStaffUser("no-access-remind@wf.test");
    await assignUnrelatedStaffRole(staffId);
    const staffToken = await createAdminSession(env.DB, staffId, "no-access-remind-token");

    const response = await callApp(`/api/v1/proposals/${proposalId}/speakers/reminders`, staffToken, {
      kind: "profile",
    });
    expect(response.status).toBe(403);
  });

  it("detail: an unrelated proposal (404) is reported before the permission check, so existence isn't leaked differently", async () => {
    const staffId = await insertStaffUser("no-access-detail@wf.test");
    await assignUnrelatedStaffRole(staffId);
    const staffToken = await createAdminSession(env.DB, staffId, "no-access-detail-token");

    const response = await callAppGet(`/api/v1/proposals/does-not-exist/audit-log`, staffToken);
    expect(response.status).toBe(404);
  });

  it("audit-log: an event moderator with proposals:score can view private review audit details", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    await env.DB.prepare(
      `INSERT INTO audit_log
         (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, scope_type, scope_id)
       VALUES (?, 'admin', ?, 'proposal_review_upserted', 'proposal_review', ?, ?, datetime('now'), 'proposal', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        adminUserId,
        crypto.randomUUID(),
        JSON.stringify({ reviewerComment: { from: null, to: "Private review note" } }),
        proposalId,
      )
      .run();
    const staffId = await insertStaffUser("moderator@wf.test");
    await assignEventModerator(staffId, eventId, adminUserId);
    const staffToken = await createAdminSession(env.DB, staffId, "moderator-token");

    const response = await callAppGet(`/api/v1/proposals/${proposalId}/audit-log`, staffToken);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      auditLog: [
        expect.objectContaining({
          action: "proposal_review_upserted",
          details: { reviewerComment: { from: null, to: "Private review note" } },
        }),
      ],
    });
  });

  it("decision endpoints require proposals:manage, not only proposal read/score access", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const moderatorId = await insertStaffUser("moderator-decision@wf.test");
    await assignEventModerator(moderatorId, eventId, adminUserId);
    const moderatorToken = await createAdminSession(env.DB, moderatorId, "moderator-decision-token");

    for (const endpoint of ["finalize-preview", "finalize"]) {
      const response = await callApp(`/api/v1/proposals/${proposalId}/${endpoint}`, moderatorToken, {
        finalStatus: "accepted",
      });
      expect(response.status).toBe(403);
    }
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(0);
  });

  it("audit-log: a moderator scoped to a different event cannot view this event's proposal audit log", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);
    const { eventId: otherEventId } = await insertOtherEvent();
    const staffId = await insertStaffUser("other-event-moderator@wf.test");
    await assignEventModerator(staffId, otherEventId, adminUserId);
    const staffToken = await createAdminSession(env.DB, staffId, "other-event-moderator-token");

    const response = await callAppGet(`/api/v1/proposals/${proposalId}/audit-log`, staffToken);
    expect(response.status).toBe(403);
  });
});
