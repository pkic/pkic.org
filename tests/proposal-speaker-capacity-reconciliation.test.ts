import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  addProposalSpeaker,
  createProposal,
  finalizeProposalDecision,
  getProposalByManageToken,
  updateProposalForVerifiedOwner,
} from "../functions/_lib/services/proposals";
import type { DatabaseLike } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  seedAcceptedSpeakerRegistration,
  seedPendingSpeakerRegistration,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";

const requestOptions = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

async function expectWaitingAndNotExempt(registrationId: string): Promise<void> {
  await expect(
    queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
      env.DB,
      "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
      [registrationId],
    ),
  ).resolves.toEqual([{ capacity_exempt_in_person: 0, capacity_exempt_reason: null }]);
  await expect(
    queryAll<{ status: string }>(
      env.DB,
      `SELECT w.status FROM event_day_waitlist_entries w
       JOIN registrations r ON r.id = w.registration_id
       WHERE r.id = ? AND w.status IN ('waiting', 'offered', 'accepted')`,
      [registrationId],
    ),
  ).resolves.toEqual([{ status: "waiting" }]);
}

describe("proposal speaker capacity reconciliation", () => {
  let adminSessionToken: string;
  let adminUserId: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb();
    ({ adminSessionToken, adminUserId, eventId } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("re-arbitrates after proposer self-service removal", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: proposal.event_id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("re-arbitrates after admin removal", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const event = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug = 'pqc-2026'"))[0];
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: event.id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("re-arbitrates after speaker self-service decline", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const event = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug = 'pqc-2026'"))[0];
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: event.id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${encodeURIComponent(speakerManageToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline", reason: "Schedule conflict" }),
      }),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
    await expect(
      queryAll(
        env.DB,
        `SELECT source_id FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker' AND status = 'active'`,
        [event.id, coSpeakerUserId],
      ),
    ).resolves.toHaveLength(0);
  });

  it("re-arbitrates an offered or accepted day row when a speaker loses exemption", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    await env.DB.prepare(
      `INSERT INTO event_day_waitlist_entries (
        id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position,
        offer_expires_at, reason_code, reason_note, created_at, updated_at
      ) VALUES ('stale-accepted-capacity-row', ?, 'speaker-capacity-day', ?, ?, 'general', 'accepted', 1,
                NULL, NULL, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(eventId, registrationId, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${encodeURIComponent(speakerManageToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline", reason: "Schedule conflict" }),
      }),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("re-arbitrates after proposer role change", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: proposal.event_id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "panelist" }),
        },
      ),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("re-arbitrates after admin role change", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const event = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug = 'pqc-2026'"))[0];
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: event.id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ role: "panelist" }),
      }),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("restores exemption when a removed speaker is re-added", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: proposal.event_id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const removeResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      requestOptions,
    );
    expect(removeResponse.status).toBe(200);
    const addResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "cospeaker@example.test",
          firstName: "Co",
          lastName: "Speaker",
          role: "speaker",
        }),
      }),
      env,
      requestOptions,
    );
    expect(addResponse.status).toBe(200);
    await expect(
      queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:speaker" }]);
  });

  it("preserves another active exempt source when changing to a non-exempt role", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId: proposal.event_id,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    await env.DB.prepare(
      `INSERT INTO event_participants
       (id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at)
       VALUES ('organizer-capacity-source', ?, ?, 'organizer', NULL, 'active', 'manual', 'organizer-capacity-source', datetime('now'), datetime('now'))`,
    )
      .bind(proposal.event_id, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "panelist" }),
        },
      ),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expect(
      queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:organizer" }]);
  });

  it("projects moderator and panelist roles without remapping them as speakers", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    const moderator = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "moderator" }),
        },
      ),
      env,
      requestOptions,
    );
    expect(moderator.status).toBe(200);
    await expect(
      queryAll(
        env.DB,
        `SELECT role, subrole, status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker'`,
        [eventId, coSpeakerUserId],
      ),
    ).resolves.toContainEqual({ role: "moderator", subrole: null, status: "active" });
    await expect(
      queryAll(env.DB, "SELECT capacity_exempt_reason FROM registrations WHERE id = ?", [registrationId]),
    ).resolves.toEqual([{ capacity_exempt_reason: "role:moderator" }]);

    const panelist = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "panelist" }),
        },
      ),
      env,
      requestOptions,
    );
    expect(panelist.status).toBe(200);
    await expect(
      queryAll(
        env.DB,
        `SELECT role, subrole, status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker'`,
        [eventId, coSpeakerUserId],
      ),
    ).resolves.toContainEqual({ role: "panelist", subrole: null, status: "active" });
    await expectWaitingAndNotExempt(registrationId);
  });

  it("retains a shared speaker projection and capacity exemption while another accepted proposal remains", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const { proposal: secondProposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: adminUserId,
      proposalType: "talk",
      title: "A second proposal with the same speaker",
      abstract: "A sufficiently detailed second proposal used to verify a speaker can have multiple accepted sources.",
    });
    await addProposalSpeaker(env.DB, { proposalId: secondProposal.id, userId: coSpeakerUserId, role: "co_speaker" });
    await finalizeProposalDecision(env.DB, {
      proposalId: secondProposal.id,
      actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const removal = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      requestOptions,
    );
    expect(removal.status).toBe(200);
    await expect(
      queryAll(
        env.DB,
        `SELECT role, subrole, status, source_ref FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker'
           AND role = 'speaker' AND subrole = 'co_speaker'`,
        [eventId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ role: "speaker", subrole: "co_speaker", status: "active", source_ref: secondProposal.id }]);
    await expect(
      queryAll(env.DB, "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?", [
        registrationId,
      ]),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:speaker" }]);
  });

  it("grants exemption and removes the waitlist when proposal acceptance activates speakers", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedPendingSpeakerRegistration({ eventId, speakerUserId: coSpeakerUserId });

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    await expect(
      queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:speaker" }]);
    await expect(
      queryAll(
        env.DB,
        "SELECT id FROM event_day_waitlist_entries WHERE registration_id = ? AND status IN ('waiting', 'offered', 'accepted')",
        [registrationId],
      ),
    ).resolves.toHaveLength(0);
  });

  it("keeps accepted capacity state when forbidden terminal-decision replacements are rejected", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedPendingSpeakerRegistration({ eventId, speakerUserId: coSpeakerUserId });
    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    for (const finalStatus of ["needs-work", "rejected"] as const) {
      await expect(
        finalizeProposalDecision(env.DB, {
          proposalId,
          actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
          finalStatus,
          decisionNote: finalStatus === "needs-work" ? "This transition is intentionally forbidden." : undefined,
          minReviewsRequired: 0,
        }),
      ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_ALREADY_FINALIZED" });
    }
    await expect(
      queryAll(env.DB, "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?", [
        registrationId,
      ]),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:speaker" }]);
  });

  it("re-arbitrates stale capacity when an unanswered needs-work proposal is rejected", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedPendingSpeakerRegistration({ eventId, speakerUserId: coSpeakerUserId });
    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "needs-work",
      decisionNote: "Please revise the proposal.",
      minReviewsRequired: 0,
    });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE registrations SET capacity_exempt_in_person = 1, capacity_exempt_reason = 'role:speaker' WHERE id = ?",
      ).bind(registrationId),
    ]);

    await finalizeProposalDecision(env.DB, {
      proposalId,
      actor: { id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "rejected",
      minReviewsRequired: 0,
    });
    await expectWaitingAndNotExempt(registrationId);
  });

  it("re-arbitrates a stale exemption during self-service withdrawal", async () => {
    const { proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedPendingSpeakerRegistration({ eventId, speakerUserId: coSpeakerUserId });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE registrations SET capacity_exempt_in_person = 1, capacity_exempt_reason = 'role:speaker' WHERE id = ?",
      ).bind(registrationId),
    ]);

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      }),
      env,
      requestOptions,
    );
    expect(response.status).toBe(200);
    await expectWaitingAndNotExempt(registrationId);
  });

  it("does not reconcile capacity when a stale withdrawal loses its primary mutation", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const registrationId = await seedPendingSpeakerRegistration({ eventId, speakerUserId: coSpeakerUserId });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE registrations SET capacity_exempt_in_person = 1, capacity_exempt_reason = 'role:speaker' WHERE id = ?",
      ).bind(registrationId),
    ]);
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare("UPDATE session_proposals SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
            .bind(proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(updateProposalForVerifiedOwner(racingDb, proposal, { action: "withdraw" })).rejects.toMatchObject({
      status: 409,
      code: "PROPOSAL_EDIT_CONFLICT",
    });
    await expect(
      queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ capacity_exempt_in_person: 1, capacity_exempt_reason: "role:speaker" }]);
  });

  it("does not count declined speakers for final-speaker protection", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const [proposal] = await queryAll<{ proposer_user_id: string }>(
      env.DB,
      "SELECT proposer_user_id FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    await env.DB.batch([
      env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?").bind(
        proposalId,
        coSpeakerUserId,
      ),
    ]);
    const proposerResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${encodeURIComponent(proposalManageToken)}/speakers/${proposal.proposer_user_id}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      requestOptions,
    );
    expect(proposerResponse.status).toBe(409);
    await expect(proposerResponse.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
    const adminResponse = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${proposal.proposer_user_id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      requestOptions,
    );
    expect(adminResponse.status).toBe(409);
    await expect(adminResponse.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
  });
});
