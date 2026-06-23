import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { onRequestPost as finalizeProposal } from "../functions/api/v1/admin/proposals/[proposalId]/finalize";
import { onRequestPost as upsertReview } from "../functions/api/v1/admin/proposals/[proposalId]/reviews";
import { onRequestPost as flagProposal } from "../functions/api/v1/admin/proposals/[proposalId]/flag";
import {
  createProposal,
  addProposalSpeaker,
  finalizeProposalDecision,
  markProposalStatus,
  softDeleteProposal,
} from "../functions/_lib/services/proposals";

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
    await env.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
      VALUES ('${id}', 'reviewer${i}@wf.test', 'reviewer${i}@wf.test', 'admin', 1, datetime('now'), datetime('now'))
    `).run();
    const token = await createAdminSession(env.DB, id, `reviewer-token-${i}`);
    await upsertReview(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/reviews`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ recommendation: "accept", score: 8 }),
        }),
        { proposalId },
      ),
    );
    extraAdminIds.push(id);
  }
  return extraAdminIds;
}

describe("proposal finalize workflows", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("accept: sets proposal status to accepted and activates participant records", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, proposerUserId, speakerUserId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      decidedByUserId: adminUserId,
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const [proposalRow] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposalRow.status).toBe("accepted");

    const participants = await queryAll<{ user_id: string; status: string }>(
      env.DB,
      "SELECT user_id, status FROM event_participants WHERE source_type = 'proposal' AND source_ref = ?",
      [proposalId],
    );
    const active = participants.filter((p) => p.status === "active").map((p) => p.user_id);
    expect(active).toContain(proposerUserId);
    expect(active).toContain(speakerUserId);
  });

  it("reject: sets proposal status to rejected and deactivates participants", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      decidedByUserId: adminUserId,
      finalStatus: "rejected",
      minReviewsRequired: 0,
    });

    const [proposalRow] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(proposalRow.status).toBe("rejected");

    const participants = await queryAll<{ user_id: string; status: string }>(
      env.DB,
      "SELECT user_id, status FROM event_participants WHERE source_type = 'proposal' AND source_ref = ?",
      [proposalId],
    );
    for (const p of participants) {
      expect(p.status).toBe("inactive");
    }
  });

  it("needs-work: sets proposal status and deactivates participants", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      decidedByUserId: adminUserId,
      finalStatus: "needs-work",
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
      decidedByUserId: adminUserId,
      finalStatus: "rejected",
      minReviewsRequired: 0,
    });

    await expect(
      finalizeProposalDecision(env.DB, {
        proposalId,
        decidedByUserId: adminUserId,
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

    const response = await finalizeProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ finalStatus: "rejected", decisionNote: "Not a fit for this event." }),
        }),
        { proposalId },
      ),
    );

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

  it("finalize HTTP handler: accepted proposal queues speaker_profile_request emails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, adminUserId } = await seedProposalWithSpeaker(eventId);

    const adminToken = await createAdminSession(env.DB, adminUserId, "finalize-accept-token");
    await addReviews(eventId, proposalId, adminUserId);

    const response = await finalizeProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ finalStatus: "accepted" }),
        }),
        { proposalId },
      ),
    );

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
    const { proposalId } = await seedProposalWithSpeaker(eventId);

    await markProposalStatus(env.DB, { proposalId, status: "spam" });

    const [row] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(row.status).toBe("spam");
  });

  it("marks a proposal as duplicate", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);

    await markProposalStatus(env.DB, { proposalId, status: "duplicate" });

    const [row] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(row.status).toBe("duplicate");
  });

  it("soft-delete: sets deleted_at and deactivates participants", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);

    await softDeleteProposal(env.DB, { proposalId });

    const [row] = await queryAll<{ status: string; deleted_at: string | null }>(
      env.DB,
      "SELECT status, deleted_at FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).not.toBeNull();

    const participants = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_participants WHERE source_type = 'proposal' AND source_ref = ?",
      [proposalId],
    );
    for (const p of participants) {
      expect(p.status).toBe("inactive");
    }
  });

  it("soft-delete: proposal excluded from default list query", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId } = await seedProposalWithSpeaker(eventId);

    await softDeleteProposal(env.DB, { proposalId });

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

    const response = await flagProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/flag`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ action: "spam" }),
        }),
        { proposalId },
      ),
    );

    expect(response.status).toBe(200);

    const [row] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM session_proposals WHERE id = ?",
      [proposalId],
    );
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

    const response = await flagProposal(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/flag`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ action: "delete" }),
        }),
        { proposalId },
      ),
    );

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
});
