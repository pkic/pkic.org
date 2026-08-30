/**
 * speaker-management.test.ts
 *
 * Covers:
 *  - GET  /api/v1/proposals/speakers/access/:token       (speaker self-view)
 *  - PATCH /api/v1/proposals/speakers/access/:token/participation (confirm / decline)
 *  - PATCH /api/v1/proposals/speakers/access/:token/profile (update profile)
 *  - POST /api/v1/events/:slug/speakers/invitations   (attendee nominates speakers)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { validJpegBytes } from "./helpers/raster-images";
import { env } from "cloudflare:workers";
import { createContext, deliveredEmailPayload, queryAll } from "./helpers/context";
import { getProposalByManageToken, getSpeakerByManageToken } from "../functions/_lib/services/proposals";
import {
  declineSpeakerParticipation,
  updateSpeakerProfile,
} from "../functions/_lib/services/proposals-speaker-profile";
import { inviteProposalSpeaker } from "../functions/_lib/services/proposal-speaker-invitations";
import { createPeerInvitations } from "../functions/_lib/services/peer-invitations";
import { getEventBySlug } from "../functions/_lib/services/events";
import { findOrCreateUser } from "../functions/_lib/services/users";
import app from "../functions/router";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import {
  remindProposalSpeakerByProposer,
  sendProposalSpeakerReminders,
} from "../functions/_lib/services/proposal-reminders";
import {
  removeProposalSpeakerByManager,
  removeProposalSpeakerByProposer,
} from "../functions/_lib/services/proposal-speaker-removal";
import {
  getProposerManagedSpeakerContext,
  updateProposalSpeakerByProposer,
} from "../functions/_lib/services/proposer-speaker-profile";
import { replaceProposalSpeakerHeadshot } from "../functions/_lib/services/proposal-speaker-headshot";
import {
  removeProposalSpeakerSelfHeadshot,
  uploadProposalSpeakerSelfHeadshot,
} from "../functions/_lib/services/proposal-speaker-self-headshot";
import type { DatabaseLike } from "../functions/_lib/types";
import { speakerSelfServiceReadResponseSchema } from "../assets/shared/schemas/speaker-self-service";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { prepareRotateUserProposalSpeakerManageSecrets } from "../functions/_lib/services/registrations/manage-capability-revocation";
import { setSpeakerPresentationReminderPreference } from "../functions/_lib/services/speaker-presentation-reminder-preferences";
import { createRegistration, confirmRegistrationByToken } from "../functions/_lib/services/registrations";
import { presentationUploadRequest } from "../assets/shared/presentation-upload";

function mountedSpeakerRoute(c: any): Promise<Response> {
  return app.fetch(c.req.raw, c.env, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

const speakerGet = mountedSpeakerRoute;
const speakerPost = mountedSpeakerRoute;
const speakerPatch = mountedSpeakerRoute;

interface StoredObject {
  body: ArrayBuffer;
  contentType: string;
}

class FakeUploadsBucket {
  private readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: Record<string, unknown>,
  ): Promise<{ size: number }> {
    let body: ArrayBuffer;

    if (typeof value === "string") {
      body = new TextEncoder().encode(value).buffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else {
      body = await new Response(value).arrayBuffer();
    }

    const contentType =
      (options?.httpMetadata as { contentType?: string } | undefined)?.contentType ?? "application/octet-stream";

    this.objects.set(key, { body, contentType });
    return { size: body.byteLength };
  }

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      async arrayBuffer() {
        return stored.body;
      },
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

let fetchMock: ReturnType<typeof vi.fn>;
let adminSessionToken: string;

async function setupWorkflow() {
  const { eventId, adminSessionToken: sessionToken } = await setupProposalSpeakerCapacityWorkflow();
  const adminUser = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
  adminSessionToken = sessionToken;
  return { eventId, adminUserId: adminUser.id };
}

async function inviteSpeakerAndSubmitProposal(): Promise<{
  speakerManageToken: string;
  proposalId: string;
  coSpeakerUserId: string;
  proposalManageToken: string;
}> {
  return inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
}

describe("speaker self-management endpoints", () => {
  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET returns speaker participation status and proposal details", async () => {
    const { eventId } = await setupWorkflow();
    await env.DB.prepare(
      `INSERT INTO event_terms (
         id, event_id, audience_type, term_key, version, required,
         content_ref, display_text, help_text, active, created_at
       ) VALUES (?, ?, 'presentation', 'presentation-rights', 'v1', 1, ?, ?, ?, 1, datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        "/presentation-rights",
        "I can share this presentation.",
        "Confirm publication rights.",
      )
      .run();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );

    expect(response.status).toBe(200);
    const body = speakerSelfServiceReadResponseSchema.parse(await response.json());
    expect(body.speaker.role).toBeTruthy();
    expect(body.proposal.title).toBe("Post-Quantum Migration Strategies");
    expect(body.profile.firstName).toBe("Co");
    expect(body.profile.email).toBe("cospeaker@example.test");
    expect(body.presentationTerms).toEqual([
      {
        termKey: "presentation-rights",
        version: "v1",
        required: true,
        contentRef: "/presentation-rights",
        displayText: "I can share this presentation.",
        helpText: "Confirm publication rights.",
      },
    ]);
    expect(body).not.toHaveProperty("manageToken");
    expect(body.proposal).not.toHaveProperty("abstract");
    expect(body.proposal).not.toHaveProperty("details");
    expect(body.profile).not.toHaveProperty("proposalProfileOverridesJson");
  });

  it("GET rejects an invalid manage token", async () => {
    await setupWorkflow();

    const response = await speakerGet(
      createContext(env, new Request("https://app.test/api/v1/proposals/speakers/access/bogus-token-0000"), {
        token: "bogus-token-0000",
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SPEAKER_TOKEN_NOT_FOUND");
  });

  it("rejects an expired unconfirmed co-speaker invitation capability", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await expect(
      queryAll<{ invite_expires_at: string | null }>(
        env.DB,
        "SELECT invite_expires_at FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ invite_expires_at: "2026-12-01T08:00:00.000Z" }]);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET invite_expires_at = '2020-01-01T00:00:00.000Z' WHERE proposal_id = ? AND user_id = ?",
    )
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SPEAKER_INVITATION_EXPIRED" } });
  });

  it("keeps self-management available after a speaker confirms before the invitation deadline", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const confirmation = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "confirmed",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );
    expect(confirmation.status).toBe(200);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET invite_expires_at = '2020-01-01T00:00:00.000Z' WHERE proposal_id = ? AND user_id = ?",
    )
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("allows a confirmed speaker to upload a presentation after the invitation deadline", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE session_proposals SET status = 'accepted', updated_at = datetime('now') WHERE id = ?",
      ).bind(proposalId),
      env.DB.prepare(
        "UPDATE proposal_speakers SET status = 'confirmed', confirmed_at = datetime('now'), invite_expires_at = '2020-01-01T00:00:00.000Z' WHERE proposal_id = ? AND user_id = ?",
      ).bind(proposalId, coSpeakerUserId),
    ]);

    const upload = presentationUploadRequest(
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "presentation.pdf", { type: "application/pdf" }),
    );
    const bucket = new FakeUploadsBucket();
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/presentation`, {
        method: "PUT",
        body: upload.body,
        headers: upload.headers,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll<{ proposal_id: string }>(
        env.DB,
        "SELECT proposal_id FROM presentation_versions WHERE proposal_id = ? AND is_current = 1",
        proposalId,
      ),
    ).resolves.toEqual([{ proposal_id: proposalId }]);
  });

  it("validates speaker participation actions through the mounted shared contract", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/speakers/access/${encodeURIComponent(speakerManageToken)}/participation`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        },
      ),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    await expect(
      queryAll<{ status: string }>(
        env.DB,
        `SELECT ps.status
         FROM proposal_speakers ps
         JOIN users u ON u.id = ps.user_id
         WHERE u.normalized_email = 'cospeaker@example.test'
         ORDER BY ps.created_at DESC LIMIT 1`,
      ),
    ).resolves.toEqual([{ status: "invited" }]);
  });

  it("lets the proposer remove a non-proposer speaker through the mounted endpoint", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const reminder = await remindProposalSpeakerByProposer(env.DB, {
      proposal,
      userId: coSpeakerUserId,
      appBaseUrl: "https://app.test",
    });

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      ),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [reminder.outboxId]),
    ).resolves.toEqual([{ status: "cancelled" }]);
    await expect(
      queryAll<{ status: string }>(
        env.DB,
        `SELECT status FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ? AND source_kind = 'proposal_speaker' AND source_ref = ?`,
        [proposal.event_id, coSpeakerUserId, proposalId],
      ),
    ).resolves.toEqual([]);
    await expect(queryAll(env.DB, "SELECT id FROM users WHERE id = ?", [coSpeakerUserId])).resolves.toHaveLength(1);
    await expect(
      queryAll<{ scope_type: string | null; scope_id: string | null }>(
        env.DB,
        `SELECT scope_type, scope_id FROM audit_log
         WHERE entity_type = 'proposal_speaker' AND action = 'proposal_speaker_removed'`,
      ),
    ).resolves.toEqual([{ scope_type: "proposal", scope_id: proposalId }]);

    const auditResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/audit-log`, {
        headers: { authorization: `Bearer ${adminSessionToken}` },
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(auditResponse.status).toBe(200);
    const auditBody = (await auditResponse.json()) as {
      auditLog: Array<{ action: string; entity_id: string | null }>;
    };
    expect(auditBody.auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "proposal_speaker_removed", entity_id: expect.any(String) }),
      ]),
    );

    const staleCapability = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );
    expect(staleCapability.status).toBe(404);
  });

  it("lets an authorized admin remove a non-proposer speaker through the mounted endpoint", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toHaveLength(0);
  });

  it("blocks final-speaker removal on both proposer and admin surfaces", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [proposal] = await queryAll<{ proposer_user_id: string }>(
      env.DB,
      "SELECT proposer_user_id FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    await env.DB.prepare("DELETE FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, coSpeakerUserId)
      .run();

    const proposerResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}/speakers/${proposal.proposer_user_id}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(proposerResponse.status).toBe(409);
    await expect(proposerResponse.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });

    const adminResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${proposal.proposer_user_id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(adminResponse.status).toBe(409);
    await expect(adminResponse.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(1);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId]),
    ).resolves.toEqual([{ status: "submitted" }]);
  });

  it("withdraws atomically while retaining the roster and cancelling queued proposal mail", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const reminder = await remindProposalSpeakerByProposer(env.DB, {
      proposal,
      userId: coSpeakerUserId,
      appBaseUrl: "https://app.test",
    });
    const invitation = await inviteProposalSpeaker(env.DB, {
      proposal,
      event,
      appBaseUrl: "https://app.test",
      email: "withdrawal-invite@example.test",
      firstName: "Pending",
      lastName: "Speaker",
      role: "speaker",
    });
    await env.DB.prepare("UPDATE email_outbox SET status = 'retrying' WHERE id = ?").bind(reminder.outboxId).run();
    const rosterBefore = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM proposal_speakers WHERE proposal_id = ? ORDER BY id",
      [proposalId],
    );
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId]),
    ).resolves.toEqual([{ status: "withdrawn" }]);
    await expect(
      queryAll<{ id: string }>(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? ORDER BY id", [
        proposalId,
      ]),
    ).resolves.toEqual(rosterBefore);
    await expect(
      queryAll<{ id: string; status: string }>(
        env.DB,
        "SELECT id, status FROM email_outbox WHERE id IN (?, ?) ORDER BY id",
        [reminder.outboxId, invitation.outboxId],
      ),
    ).resolves.toEqual([reminder.outboxId, invitation.outboxId].sort().map((id) => ({ id, status: "cancelled" })));
    const participants = await queryAll<{ status: string }>(
      env.DB,
      `SELECT status FROM event_participant_role_sources
       WHERE event_id = ? AND source_kind = 'proposal_speaker' AND source_ref = ?`,
      [proposal.event_id, proposalId],
    );
    expect(participants.length).toBeGreaterThan(0);
    expect(participants.every((participant) => participant.status === "inactive")).toBe(true);
  });

  it("rolls back withdrawal mail cancellation and participant fallout when audit fails", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const reminder = await remindProposalSpeakerByProposer(env.DB, {
      proposal,
      userId: coSpeakerUserId,
      appBaseUrl: "https://app.test",
    });
    const rosterBefore = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM proposal_speakers WHERE proposal_id = ? ORDER BY id",
      [proposalId],
    );
    const participantsBefore = await queryAll<{ user_id: string; role: string; status: string }>(
      env.DB,
      `SELECT user_id, role, status FROM event_participant_role_sources
       WHERE source_kind = 'proposal_speaker' AND source_ref = ? ORDER BY user_id, role`,
      [proposalId],
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_proposal_withdrawal_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'proposal_withdrawn'
       BEGIN SELECT RAISE(ABORT, 'forced withdrawal audit failure'); END`,
    ).run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(500);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId]),
    ).resolves.toEqual([{ status: "submitted" }]);
    await expect(
      queryAll<{ id: string }>(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? ORDER BY id", [
        proposalId,
      ]),
    ).resolves.toEqual(rosterBefore);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [reminder.outboxId]),
    ).resolves.toEqual([{ status: "queued" }]);
    const participants = await queryAll<{ user_id: string; role: string; status: string }>(
      env.DB,
      `SELECT user_id, role, status FROM event_participant_role_sources
       WHERE source_kind = 'proposal_speaker' AND source_ref = ? ORDER BY user_id, role`,
      [proposalId],
    );
    expect(participantsBefore.length).toBeGreaterThan(0);
    expect(participants).toEqual(participantsBefore);
  });

  it("rejects non-owner role patches which would claim proposal ownership", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [proposal] = await queryAll<{ proposer_user_id: string }>(
      env.DB,
      "SELECT proposer_user_id FROM session_proposals WHERE id = ?",
      [proposalId],
    );

    const ownerRoleResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${proposal.proposer_user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ role: "speaker" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(ownerRoleResponse.status).toBe(200);

    const nonOwnerResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ role: "proposer" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(nonOwnerResponse.status).toBe(409);
    await expect(nonOwnerResponse.json()).resolves.toMatchObject({ error: { code: "PROPOSER_TRANSFER_REQUIRED" } });

    await expect(
      queryAll<{ user_id: string; role: string }>(
        env.DB,
        "SELECT user_id, role FROM proposal_speakers WHERE proposal_id = ? ORDER BY user_id",
        [proposalId],
      ),
    ).resolves.toEqual(
      [
        { user_id: proposal.proposer_user_id, role: "speaker" },
        { user_id: coSpeakerUserId, role: "co_speaker" },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
    );
  });

  it("lets an owner with a presentation role change that role without transferring ownership", async () => {
    await setupWorkflow();
    const { proposalId } = await inviteSpeakerAndSubmitProposal();
    const [proposal] = await queryAll<{ proposer_user_id: string }>(
      env.DB,
      "SELECT proposer_user_id FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    await env.DB.prepare("UPDATE proposal_speakers SET role = 'moderator' WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, proposal.proposer_user_id)
      .run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${proposal.proposer_user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ role: "speaker" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll<{ proposer_user_id: string; role: string }>(
        env.DB,
        `SELECT sp.proposer_user_id, ps.role
         FROM session_proposals sp JOIN proposal_speakers ps ON ps.proposal_id = sp.id AND ps.user_id = sp.proposer_user_id
         WHERE sp.id = ?`,
        [proposalId],
      ),
    ).resolves.toEqual([{ proposer_user_id: proposal.proposer_user_id, role: "speaker" }]);
  });

  it("requires explicit admin transfer and atomically rotates proposal ownership capability", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [before] = await queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
      env.DB,
      "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
      [proposalId],
    );

    const selfRemoval = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}/speakers/${before.proposer_user_id}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(selfRemoval.status).toBe(409);
    await expect(selfRemoval.json()).resolves.toMatchObject({ error: { code: "PROPOSER_REPLACEMENT_REQUIRED" } });

    const transfer = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${before.proposer_user_id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ replacementProposerUserId: coSpeakerUserId }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(transfer.status).toBe(200);
    await expect(transfer.json()).resolves.toMatchObject({ proposerUserId: coSpeakerUserId });

    const [after] = await queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
      env.DB,
      "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    expect(after.proposer_user_id).toBe(coSpeakerUserId);
    expect(after.manage_link_secret).not.toBe(before.manage_link_secret);
    await expect(
      queryAll<{ user_id: string; role: string }>(
        env.DB,
        "SELECT user_id, role FROM proposal_speakers WHERE proposal_id = ?",
        [proposalId],
      ),
    ).resolves.toEqual([{ user_id: coSpeakerUserId, role: "co_speaker" }]);
    await expect(
      queryAll<{ user_id: string; role: string; subrole: string | null }>(
        env.DB,
        `SELECT user_id, role, subrole FROM event_participant_role_sources
         WHERE event_id = (SELECT event_id FROM session_proposals WHERE id = ?)
           AND source_kind = 'proposal_speaker' AND source_ref = ? AND user_id = ?`,
        [proposalId, proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ user_id: coSpeakerUserId, role: "speaker", subrole: "co_speaker" }]);

    const staleProposalCapability = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}`),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(staleProposalCapability.status).toBe(404);
    await expect(
      queryAll<{ action: string }>(
        env.DB,
        `SELECT action FROM audit_log
         WHERE action IN ('proposal_proposer_transferred', 'proposal_speaker_removed')
         ORDER BY action`,
      ),
    ).resolves.toEqual([{ action: "proposal_proposer_transferred" }, { action: "proposal_speaker_removed" }]);
    const transferMail = await queryAll<{
      recipient_user_id: string;
      template_key: string;
      status: string;
      payload_json: string;
    }>(
      env.DB,
      `SELECT recipient_user_id, template_key, status, payload_json
       FROM email_outbox WHERE template_key = 'proposal_manage_link_transferred'`,
    );
    expect(transferMail).toHaveLength(1);
    expect(transferMail[0]).toMatchObject({
      recipient_user_id: coSpeakerUserId,
      template_key: "proposal_manage_link_transferred",
      status: "queued",
    });
    expect(JSON.parse(transferMail[0].payload_json).proposalId).toBe(proposalId);
    const deliveredTransfer = await deliveredEmailPayload<{ manageUrl: string }>(
      env.DB,
      env,
      transferMail[0].payload_json,
    );
    const replacementToken = new URL(deliveredTransfer.manageUrl).searchParams.get("token");
    expect(replacementToken).toBeTruthy();
    const replacementAccess = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${encodeURIComponent(replacementToken!)}`),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(replacementAccess.status).toBe(200);
    await expect(replacementAccess.json()).resolves.toMatchObject({
      proposal: { id: proposalId, proposer_user_id: coSpeakerUserId },
    });
  });

  it("rejects a declined speaker as replacement proposer without rotating ownership", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [before] = await queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
      env.DB,
      "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${before.proposer_user_id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ replacementProposerUserId: coSpeakerUserId }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
    await expect(
      queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
        env.DB,
        "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
        [proposalId],
      ),
    ).resolves.toEqual([before]);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'proposal_manage_link_transferred'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back proposer transfer when the proposal changes before the atomic batch", async () => {
    const { adminUserId } = await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [before] = await queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
      env.DB,
      "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
      [proposalId],
    );
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

    await expect(
      removeProposalSpeakerByManager(racingDb, {
        actor: { identityType: "user", id: adminUserId, email: "admin@pkic.org", role: "admin" },
        proposalId,
        userId: before.proposer_user_id,
        replacementProposerUserId: coSpeakerUserId,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll<{ proposer_user_id: string; manage_link_secret: string }>(
        env.DB,
        "SELECT proposer_user_id, manage_link_secret FROM session_proposals WHERE id = ?",
        [proposalId],
      ),
    ).resolves.toEqual([{ ...before, manage_link_secret: before.manage_link_secret }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(2);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'proposal_manage_link_transferred'"),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_proposer_transferred'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back removal, participant changes, and email cancellation when audit fails", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const reminder = await remindProposalSpeakerByProposer(env.DB, {
      proposal,
      userId: coSpeakerUserId,
      appBaseUrl: "https://app.test",
    });
    await env.DB.prepare(
      `CREATE TRIGGER fail_speaker_removal_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'proposal_speaker_removed'
       BEGIN SELECT RAISE(ABORT, 'forced speaker removal audit failure'); END`,
    ).run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(500);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toHaveLength(1);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [reminder.outboxId]),
    ).resolves.toEqual([{ status: "queued" }]);
    await env.DB.prepare("DROP TRIGGER fail_speaker_removal_audit").run();
  });

  it("rolls back a stale removal when the proposal changes before the D1 batch", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
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

    await expect(
      removeProposalSpeakerByProposer(racingDb, {
        manageToken: proposalManageToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        userId: coSpeakerUserId,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toHaveLength(1);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'proposal_speaker_removed'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back speaker removal when its proposal headshot snapshot changes", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const originalKey = `proposal-headshots/${proposalId}/${coSpeakerUserId}/original.jpg`;
    const replacementKey = `proposal-headshots/${proposalId}/${coSpeakerUserId}/replacement.jpg`;
    await env.DB.prepare(
      `UPDATE proposal_speakers
       SET headshot_override_set = 1, headshot_r2_key = ?, headshot_updated_at = '2026-08-22T00:00:00.000Z'
       WHERE proposal_id = ? AND user_id = ?`,
    )
      .bind(originalKey, proposalId, coSpeakerUserId)
      .run();

    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare("UPDATE proposal_speakers SET headshot_r2_key = ? WHERE proposal_id = ? AND user_id = ?")
            .bind(replacementKey, proposalId, coSpeakerUserId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      removeProposalSpeakerByProposer(racingDb, {
        manageToken: proposalManageToken,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        userId: coSpeakerUserId,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll<{ headshot_r2_key: string | null }>(
        env.DB,
        "SELECT headshot_r2_key FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ headshot_r2_key: replacementKey }]);
    await expect(
      queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE object_key IN (?, ?)", [
        originalKey,
        replacementKey,
      ]),
    ).resolves.toHaveLength(0);
  });

  it("POST confirm — confirms speaker participation with required consents", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "confirmed",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe("confirmed");
  });

  it("POST confirm — rejects an existing capability after the proposal closes", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .bind(proposalId)
      .run();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "confirmed",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_CLOSED" } });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
  });

  it("POST confirm — remains idempotent after an already-confirmed proposal closes", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId } = await inviteSpeakerAndSubmitProposal();
    const request = () =>
      speakerPost(
        createContext(
          env,
          new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              status: "confirmed",
              consents: [{ termKey: "speaker-terms", version: "v1" }],
            }),
          }),
          { token: speakerManageToken },
        ),
      );

    expect((await request()).status).toBe(200);
    await env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .bind(proposalId)
      .run();
    expect((await request()).status).toBe(200);
  });

  it("rolls back consent and speaker confirmation when its audit write fails", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare(
      `CREATE TRIGGER reject_speaker_confirmed_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'speaker_confirmed'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "confirmed",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(500);
    const speakerRows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    expect(speakerRows[0]?.status).toBe("invited");
    const consents = await queryAll<{ count: number }>(
      env.DB,
      "SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    expect(consents[0]?.count).toBe(0);
    await env.DB.prepare("DROP TRIGGER reject_speaker_confirmed_audit").run();
  });

  it("POST decline — declines speaker participation with optional reason", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "declined",
            reason: "Schedule conflict",
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe("declined");
  });

  it("POST decline — rejects a capability after the proposal closes", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .bind(proposalId)
      .run();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "declined", reason: "Too late" }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_CLOSED" } });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
  });

  it("PATCH updates speaker profile fields", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPatch(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/profile`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Updated",
            lastName: "Speaker",
            organizationName: "Quantum Labs",
            jobTitle: "Principal Researcher",
            biography: "Updated bio with post-quantum expertise.",
            links: ["https://linkedin.com/in/speaker"],
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);

    // Verify the profile was updated
    const getResponse = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );
    const profile = (await getResponse.json()) as {
      profile: {
        firstName: string;
        lastName: string;
        organizationName: string;
        jobTitle: string;
        biography: string;
        links: string[];
      };
    };
    expect(profile.profile.firstName).toBe("Updated");
    expect(profile.profile.lastName).toBe("Speaker");
    expect(profile.profile.organizationName).toBe("Quantum Labs");
    expect(profile.profile.jobTitle).toBe("Principal Researcher");
    expect(profile.profile.biography).toBe("Updated bio with post-quantum expertise.");
    expect(profile.profile.links).toEqual(["https://linkedin.com/in/speaker"]);
  });

  it("PATCH preserves links when another profile field is updated", async () => {
    await setupWorkflow();
    const { speakerManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare("UPDATE users SET links_json = ? WHERE id = ?")
      .bind('["https://example.test/existing"]', coSpeakerUserId)
      .run();

    const response = await speakerPatch(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/profile`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobTitle: "Updated title" }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);
    const rows = await queryAll<{ links_json: string | null }>(
      env.DB,
      "SELECT links_json FROM users WHERE id = ?",
      coSpeakerUserId,
    );
    expect(JSON.parse(rows[0]?.links_json ?? "[]")).toEqual(["https://example.test/existing"]);
  });

  it("PATCH rejects a capability after proposal closure without changing the account profile", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?")
      .bind(proposalId)
      .run();

    const response = await speakerPatch(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/profile`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: "Must not commit" }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_CLOSED" } });
    await expect(queryAll(env.DB, "SELECT first_name FROM users WHERE id = ?", [coSpeakerUserId])).resolves.toEqual([
      { first_name: "Co" },
    ]);
  });

  it("rejects a stale speaker profile patch without clearing a newer proposal override", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [speaker] = await queryAll<{
      id: string;
      status: string;
      invite_generation: number;
      profile_overrides_json: string;
    }>(
      env.DB,
      "SELECT id, status, invite_generation, profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    const [proposal] = await queryAll<{ status: string; updated_at: string }>(
      env.DB,
      "SELECT status, updated_at FROM session_proposals WHERE id = ?",
      proposalId,
    );
    await env.DB.prepare("UPDATE proposal_speakers SET profile_overrides_json = ? WHERE id = ?")
      .bind('{"firstName":"Admin curated"}', speaker.id)
      .run();

    await expect(
      updateSpeakerProfile(
        env.DB,
        { firstName: "Speaker edit" },
        {
          proposalSpeakerId: speaker.id,
          proposalId,
          proposalStatus: proposal.status,
          proposalUpdatedAt: proposal.updated_at,
          userId: coSpeakerUserId,
          currentStatus: speaker.status,
          inviteGeneration: speaker.invite_generation,
          expectedProfileOverridesJson: speaker.profile_overrides_json,
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });

    const [profile] = await queryAll<{ first_name: string | null }>(
      env.DB,
      "SELECT first_name FROM users WHERE id = ?",
      coSpeakerUserId,
    );
    expect(profile.first_name).toBe("Co");
    const [override] = await queryAll<{ profile_overrides_json: string }>(
      env.DB,
      "SELECT profile_overrides_json FROM proposal_speakers WHERE id = ?",
      speaker.id,
    );
    expect(override.profile_overrides_json).toBe('{"firstName":"Admin curated"}');
  });

  it("rolls back an account profile patch when the proposal closes after authorization", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const [speaker] = await queryAll<{
      id: string;
      status: string;
      invite_generation: number;
      profile_overrides_json: string | null;
    }>(
      env.DB,
      "SELECT id, status, invite_generation, profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      [proposalId, coSpeakerUserId],
    );
    const [proposal] = await queryAll<{ status: string; updated_at: string }>(
      env.DB,
      "SELECT status, updated_at FROM session_proposals WHERE id = ?",
      proposalId,
    );
    await env.DB.prepare("UPDATE session_proposals SET status = 'rejected', updated_at = ? WHERE id = ?")
      .bind("2099-01-01T00:00:00.000Z", proposalId)
      .run();

    await expect(
      updateSpeakerProfile(
        env.DB,
        { firstName: "Must not commit" },
        {
          proposalSpeakerId: speaker.id,
          proposalId,
          proposalStatus: proposal.status,
          proposalUpdatedAt: proposal.updated_at,
          userId: coSpeakerUserId,
          currentStatus: speaker.status,
          inviteGeneration: speaker.invite_generation,
          expectedProfileOverridesJson: speaker.profile_overrides_json,
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT first_name FROM users WHERE id = ?", [coSpeakerUserId])).resolves.toEqual([
      { first_name: "Co" },
    ]);
  });

  it("rolls back a speaker profile patch when canonical-email revocation wins the commit race", async () => {
    await setupWorkflow();
    const { speakerManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const { speaker, proposal, user } = await getSpeakerByManageToken(
      env.DB,
      speakerManageToken,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([prepareRotateUserProposalSpeakerManageSecrets(env.DB, coSpeakerUserId)]),
    );

    await expect(
      updateSpeakerProfile(
        racingDb,
        { firstName: "Must not commit" },
        {
          proposalSpeakerId: speaker.id,
          proposalId: proposal.id,
          proposalStatus: proposal.status,
          proposalUpdatedAt: proposal.updated_at,
          userId: user.id,
          currentStatus: speaker.status,
          inviteGeneration: speaker.invite_generation,
          expectedProfileOverridesJson: user.proposalProfileOverridesJson,
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT first_name FROM users WHERE id = ?", [coSpeakerUserId])).resolves.toEqual([
      { first_name: "Co" },
    ]);
  });

  it("rolls back a decline when canonical-email revocation wins the commit race", async () => {
    await setupWorkflow();
    const { speakerManageToken, coSpeakerUserId, proposalId } = await inviteSpeakerAndSubmitProposal();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([prepareRotateUserProposalSpeakerManageSecrets(env.DB, coSpeakerUserId)]),
    );

    await expect(
      declineSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        reason: "Must not commit",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
  });

  it("rolls back reminder preferences when canonical-email revocation wins the commit race", async () => {
    await setupWorkflow();
    const { speakerManageToken, coSpeakerUserId, proposalId } = await inviteSpeakerAndSubmitProposal();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([prepareRotateUserProposalSpeakerManageSecrets(env.DB, coSpeakerUserId)]),
    );

    await expect(
      setSpeakerPresentationReminderPreference(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, "paused"),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(
        env.DB,
        "SELECT presentation_reminders_paused_until FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ presentation_reminders_paused_until: null }]);
  });

  it("proposal manage token updates speaker profile fields", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: "Casey",
          lastName: "Cryptographer",
          organizationName: "PKIC Labs",
          jobTitle: "Senior Engineer",
          biography: "Provided by the proposer.",
          links: ["https://github.com/casey"],
        }),
      }),
      env,
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(response.status).toBe(200);

    const accountProfile = await queryAll<{
      first_name: string | null;
      last_name: string | null;
      organization_name: string | null;
      job_title: string | null;
      biography: string | null;
      links_json: string | null;
    }>(
      env.DB,
      `SELECT first_name, last_name, organization_name, job_title, biography, links_json
       FROM users WHERE id = ?`,
      coSpeakerUserId,
    );
    expect(accountProfile[0]).toEqual({
      first_name: "Co",
      last_name: "Speaker",
      organization_name: "Co Corp",
      job_title: "CTO",
      biography: null,
      links_json: null,
    });

    const scopedProfile = await queryAll<{ profile_overrides_json: string }>(
      env.DB,
      "SELECT profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    expect(JSON.parse(scopedProfile[0]?.profile_overrides_json ?? "{}")).toEqual({
      firstName: "Casey",
      lastName: "Cryptographer",
      organizationName: "PKIC Labs",
      jobTitle: "Senior Engineer",
      biography: "Provided by the proposer.",
      links: ["https://github.com/casey"],
    });

    const manageGet = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}`),
      env,
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    const payload = (await manageGet.json()) as {
      speakers: Array<{
        userId: string;
        firstName: string | null;
        lastName: string | null;
        organizationName: string | null;
        jobTitle: string | null;
        bio: string | null;
        links: string[];
      }>;
    };
    const speaker = payload.speakers.find((entry) => entry.userId === coSpeakerUserId);
    expect(speaker).toMatchObject({
      firstName: "Casey",
      lastName: "Cryptographer",
      organizationName: "PKIC Labs",
      jobTitle: "Senior Engineer",
      bio: "Provided by the proposer.",
      links: ["https://github.com/casey"],
    });
  });

  it("validates mounted proposer speaker reminder and profile mutation contracts", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const workerContext = { passThroughOnException: () => {}, waitUntil: () => {} } as any;
    const headers = { "content-type": "application/json" };

    const reminderResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/not-a-uuid/reminders`, {
        method: "POST",
      }),
      env,
      workerContext,
    );
    expect(reminderResponse.status).toBe(400);
    expect(await reminderResponse.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const patchResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/not-a-uuid`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ firstName: "Invalid target" }),
      }),
      env,
      workerContext,
    );
    expect(patchResponse.status).toBe(400);
    expect(await patchResponse.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const validPatchResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ firstName: "Mounted" }),
      }),
      env,
      workerContext,
    );
    expect(validPatchResponse.status).toBe(200);
    expect(await validPatchResponse.json()).toEqual({ success: true });
  });

  it("rolls back proposer-managed speaker profile and role changes when audit fails", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId, proposalId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare(
      `CREATE TRIGGER reject_proposer_speaker_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'speaker_profile_updated_by_proposer'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: "Must Roll Back", role: "moderator" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(500);
    const rows = await queryAll<{ first_name: string | null; role: string }>(
      env.DB,
      `SELECT u.first_name, ps.role
       FROM proposal_speakers ps JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id = ? AND ps.user_id = ?`,
      proposalId,
      coSpeakerUserId,
    );
    expect(rows[0]).toEqual({ first_name: "Co", role: "co_speaker" });
    await env.DB.prepare("DROP TRIGGER reject_proposer_speaker_audit").run();
  });

  it("rejects a stale combined proposer profile and role update before capacity side effects", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId, proposalId } = await inviteSpeakerAndSubmitProposal();
    const context = await getProposerManagedSpeakerContext(
      env.DB,
      proposalManageToken,
      coSpeakerUserId,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const newerOverrides = '{"firstName":"Newer admin value"}';
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare("UPDATE proposal_speakers SET profile_overrides_json = ? WHERE id = ?")
            .bind(newerOverrides, context.speaker.id)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      updateProposalSpeakerByProposer(racingDb, {
        ...context,
        patch: { firstName: "Stale proposer value", role: "moderator" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll<{ role: string; profile_overrides_json: string }>(
        env.DB,
        "SELECT role, profile_overrides_json FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ role: "co_speaker", profile_overrides_json: newerOverrides }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'speaker_profile_updated_by_proposer'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back a co-speaker user, participant, and email when the invite batch fails", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare(
      `CREATE TRIGGER reject_co_speaker_invite_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'co_speaker_invite'
       BEGIN
         SELECT RAISE(ABORT, 'forced outbox failure');
       END`,
    ).run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "rollback-speaker@example.test", firstName: "Rollback", role: "speaker" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(500);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM users WHERE normalized_email = ?",
          "rollback-speaker@example.test",
        )
      )[0]?.count,
    ).toBe(0);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM proposal_speakers WHERE proposal_id = ?",
          proposalId,
        )
      )[0]?.count,
    ).toBe(2);
    await env.DB.prepare("DROP TRIGGER reject_co_speaker_invite_email").run();
  });

  it.each(["spam", "duplicate"] as const)(
    "rejects co-speaker invitations for %s proposals through the mounted endpoint",
    async (status) => {
      await setupWorkflow();
      const { proposalManageToken, proposalId } = await inviteSpeakerAndSubmitProposal();
      await env.DB.prepare(
        "UPDATE session_proposals SET status = ?, updated_at = datetime('now', '+1 second') WHERE id = ?",
      )
        .bind(status, proposalId)
        .run();

      const response = await app.fetch(
        new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `blocked-${status}@example.test`, firstName: "Blocked", role: "speaker" }),
        }),
        env,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_CLOSED" } });
      await expect(
        queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM users WHERE normalized_email = ?",
          `blocked-${status}@example.test`,
        ),
      ).resolves.toEqual([{ count: 0 }]);
      await expect(
        queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM proposal_speakers WHERE proposal_id = ?",
          proposalId,
        ),
      ).resolves.toEqual([{ count: 2 }]);
      await expect(
        queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ? AND template_key = 'co_speaker_invite'",
          `blocked-${status}@example.test`,
        ),
      ).resolves.toEqual([{ count: 0 }]);
    },
  );

  it("rolls back a co-speaker invite when moderation closes the proposal after the snapshot", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare(
              "UPDATE session_proposals SET status = 'duplicate', updated_at = datetime('now', '+1 second') WHERE id = ?",
            )
            .bind(proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      inviteProposalSpeaker(racingDb, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email: "race-closed-speaker@example.test",
        firstName: "Race",
        lastName: "Closed",
        role: "speaker",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CHANGED" });

    await expect(
      queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM users WHERE normalized_email = ?",
        "race-closed-speaker@example.test",
      ),
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM proposal_speakers WHERE proposal_id = ?",
        proposalId,
      ),
    ).resolves.toEqual([{ count: 2 }]);
    await expect(
      queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM email_outbox WHERE recipient_email = ? AND template_key = 'co_speaker_invite'",
        "race-closed-speaker@example.test",
      ),
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'co_speaker_invited' AND scope_type = 'proposal' AND scope_id = ?",
        proposalId,
      ),
    ).resolves.toEqual([{ count: 0 }]);
    await expect(
      queryAll<{ count: number }>(
        env.DB,
        `SELECT COUNT(*) AS count
         FROM event_participant_role_sources AS sources
         JOIN users ON users.id = sources.user_id
         WHERE users.normalized_email = ?`,
        "race-closed-speaker@example.test",
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("deduplicates concurrent co-speaker invitations but permits a new invitation after decline", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const invitedUser = await findOrCreateUser(env.DB, {
      email: "concurrent-speaker@example.test",
      firstName: "Concurrent",
      lastName: "Speaker",
    });
    const invite = () =>
      inviteProposalSpeaker(env.DB, {
        proposal,
        event,
        appBaseUrl: "https://app.test",
        email: invitedUser.email,
        firstName: invitedUser.first_name ?? undefined,
        lastName: invitedUser.last_name ?? undefined,
        role: "speaker",
      });

    const [firstInvite, concurrentInvite] = await Promise.all([invite(), invite()]);
    expect(firstInvite.outboxId).toBe(concurrentInvite.outboxId);

    const [speaker] = await queryAll<{
      id: string;
      status: string;
      invite_generation: number;
      manage_link_secret: string;
    }>(
      env.DB,
      `SELECT id, status, invite_generation, manage_link_secret FROM proposal_speakers
       WHERE proposal_id = ? AND user_id = ?`,
      proposalId,
      invitedUser.id,
    );
    expect(speaker).toMatchObject({ status: "invited", invite_generation: 0 });
    const oldManageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speaker.id,
    });
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          `SELECT COUNT(*) AS count FROM email_outbox
           WHERE template_key = 'co_speaker_invite' AND recipient_user_id = ?`,
          invitedUser.id,
        )
      )[0]?.count,
    ).toBe(1);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          `SELECT COUNT(*) AS count FROM audit_log
           WHERE action = 'co_speaker_invited' AND entity_id = ?`,
          speaker.id,
        )
      )[0]?.count,
    ).toBe(1);

    const speakerManageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speaker.id,
    });
    const declineResponse = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "declined", reason: "Not available" }),
        }),
        { token: speakerManageToken },
      ),
    );
    expect(declineResponse.status).toBe(200);

    const reinvite = await invite();
    expect(reinvite.outboxId).not.toBe(firstInvite.outboxId);
    const [reinvitedSpeaker] = await queryAll<{
      status: string;
      invite_generation: number;
      manage_link_secret: string;
    }>(env.DB, "SELECT status, invite_generation, manage_link_secret FROM proposal_speakers WHERE id = ?", speaker.id);
    expect(reinvitedSpeaker).toMatchObject({ status: "invited", invite_generation: 1 });
    expect(reinvitedSpeaker.manage_link_secret).not.toBe(speaker.manage_link_secret);

    const mountedEnv = { ...(env as any), SPEAKER_UPLOADS_BUCKET: new FakeUploadsBucket() };
    const mounted = (request: Request) =>
      app.fetch(request, mountedEnv, {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
    const expectStaleCapability = async (request: Request) => {
      const response = await mounted(request);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "SPEAKER_TOKEN_NOT_FOUND" },
      });
    };
    const staleTokenPath = `https://app.test/api/v1/proposals/speakers/access/${oldManageToken}`;
    await expectStaleCapability(new Request(staleTokenPath));
    await expectStaleCapability(
      new Request(`${staleTokenPath}/participation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "declined", reason: "stale token" }),
      }),
    );
    await expectStaleCapability(
      new Request(`${staleTokenPath}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biography: "stale token" }),
      }),
    );

    const staleHeadshotPath = `${staleTokenPath}/headshot`;
    await expectStaleCapability(new Request(staleHeadshotPath));
    const staleHeadshotForm = new FormData();
    staleHeadshotForm.append("file", new File([validJpegBytes()], "headshot.jpg", { type: "image/jpeg" }));
    await expectStaleCapability(new Request(staleHeadshotPath, { method: "PUT", body: staleHeadshotForm }));
    await expectStaleCapability(new Request(staleHeadshotPath, { method: "DELETE" }));

    const stalePresentationForm = new FormData();
    stalePresentationForm.append(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "presentation.pdf", { type: "application/pdf" }),
    );
    await expectStaleCapability(
      new Request(`${staleTokenPath}/presentation`, { method: "PUT", body: stalePresentationForm }),
    );
    await expectStaleCapability(new Request(`${staleTokenPath}/presentation`));
    await expectStaleCapability(
      new Request(`${staleTokenPath}/reminder-preferences`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "paused" }),
      }),
    );

    const newManageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "speaker_manage",
      resourceId: speaker.id,
    });
    const currentResponse = await mounted(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${newManageToken}`),
    );
    expect(currentResponse.status).toBe(200);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          `SELECT COUNT(*) AS count FROM email_outbox
           WHERE template_key = 'co_speaker_invite' AND recipient_user_id = ?`,
          invitedUser.id,
        )
      )[0]?.count,
    ).toBe(2);
  });

  it("proposal manage token uploads and serves a speaker headshot", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const bucket = new FakeUploadsBucket();

    const file = new File([validJpegBytes()], "headshot.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    const uploadResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
        {
          method: "PUT",
          body: formData,
        },
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(uploadResponse.status).toBe(200);
    const uploadPayload = (await uploadResponse.json()) as { success: boolean; headshotUrl: string; r2Key: string };
    expect(uploadPayload.success).toBe(true);
    expect(uploadPayload.headshotUrl).toContain(
      `/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
    );
    expect(uploadPayload.r2Key.startsWith(`proposal-headshots/${proposalId}/${coSpeakerUserId}/`)).toBe(true);
    expect(
      (
        await queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
          coSpeakerUserId,
        ])
      )[0]?.headshot_r2_key,
    ).toBeNull();

    const serveResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(serveResponse.status).toBe(200);
    expect(serveResponse.headers.get("content-type")).toBe("image/jpeg");

    const deleteResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
        { method: "DELETE" },
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(deleteResponse.status).toBe(200);

    const repeatedDeleteResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
        { method: "DELETE" },
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(repeatedDeleteResponse.status).toBe(200);

    const replacementForm = new FormData();
    replacementForm.append("file", file);
    const replacementResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
        { method: "PUT", body: replacementForm },
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(replacementResponse.status).toBe(200);
    const replacementPayload = (await replacementResponse.json()) as { r2Key: string };

    const removeSpeakerResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
        method: "DELETE",
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(removeSpeakerResponse.status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).toHaveLength(0);
    expect(
      await queryAll<{ object_key: string }>(
        env.DB,
        "SELECT object_key FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads' AND object_key = ?",
        [replacementPayload.r2Key],
      ),
    ).toEqual([{ object_key: replacementPayload.r2Key }]);
  });

  it("rejects a proposer headshot upload when the proposal closes before commit", async () => {
    await setupWorkflow();
    const { proposalManageToken, proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const { proposal, speaker } = await getProposerManagedSpeakerContext(
      env.DB,
      proposalManageToken,
      coSpeakerUserId,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const bucket = new FakeUploadsBucket();
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare(
              "UPDATE session_proposals SET status = 'withdrawn', updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?",
            )
            .bind(proposalId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      replaceProposalSpeakerHeadshot({
        db: racingDb,
        bucket: bucket as unknown as R2Bucket,
        proposalId,
        proposalSpeakerId: speaker.id,
        speakerUserId: speaker.user_id,
        previousOverrideSet: speaker.headshot_override_set,
        previousOverrideKey: speaker.headshot_override_r2_key,
        editableProposalSnapshot: { status: proposal.status, updatedAt: proposal.updated_at },
        image: { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" },
        audit: {
          actorType: "user",
          actorId: proposal.proposer_user_id,
          action: "speaker_headshot_uploaded_by_proposer",
          scope: { type: "proposal", id: proposalId },
        },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(bucket.keys()).toEqual([]);
    await expect(
      queryAll<{ headshot_override_set: number; headshot_r2_key: string | null }>(
        env.DB,
        "SELECT headshot_override_set, headshot_r2_key FROM proposal_speakers WHERE id = ?",
        [speaker.id],
      ),
    ).resolves.toEqual([{ headshot_override_set: 0, headshot_r2_key: null }]);
  });

  it("speaker manage token uploads and serves a speaker headshot", async () => {
    await setupWorkflow();
    const { speakerManageToken, proposalManageToken, proposalId, coSpeakerUserId } =
      await inviteSpeakerAndSubmitProposal();
    const bucket = new FakeUploadsBucket();

    const file = new File([validJpegBytes()], "headshot.jpg", { type: "image/jpeg" });
    const proposerFormData = new FormData();
    proposerFormData.append("file", file);
    const proposerUpload = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
        { method: "PUT", body: proposerFormData },
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(proposerUpload.status).toBe(200);
    const proposerR2Key = ((await proposerUpload.json()) as { r2Key: string }).r2Key;

    const formData = new FormData();
    formData.append("file", file);

    const uploadResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/headshot`, {
        method: "PUT",
        body: formData,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(uploadResponse.status).toBe(200);
    const [account, scoped] = await Promise.all([
      queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        coSpeakerUserId,
      ]),
      queryAll<{ headshot_override_set: number; headshot_r2_key: string | null }>(
        env.DB,
        `SELECT headshot_override_set, headshot_r2_key
         FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?`,
        [proposalId, coSpeakerUserId],
      ),
    ]);
    expect(account[0]?.headshot_r2_key).toMatch(new RegExp(`^headshots/${coSpeakerUserId}/`));
    expect(scoped[0]).toEqual({ headshot_override_set: 0, headshot_r2_key: null });
    expect(
      await queryAll<{ object_key: string }>(
        env.DB,
        "SELECT object_key FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads' AND object_key = ?",
        [proposerR2Key],
      ),
    ).toEqual([{ object_key: proposerR2Key }]);

    const serveResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/headshot`),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(serveResponse.status).toBe(200);
    expect(serveResponse.headers.get("content-type")).toBe("image/jpeg");
  });

  it("compensates a self headshot upload when canonical-email revocation wins the D1 race", async () => {
    await setupWorkflow();
    const { speakerManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const { speaker, proposal, user } = await getSpeakerByManageToken(
      env.DB,
      speakerManageToken,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const [{ total: badgeJobsBeforeUpload }] = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM badge_render_jobs",
    );
    const bucket = new FakeUploadsBucket();
    const scopedEnv = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket } as any;
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb.batch([prepareRotateUserProposalSpeakerManageSecrets(baseDb, user.id)]);
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      uploadProposalSpeakerSelfHeadshot(
        {
          db: racingDb,
          env: scopedEnv,
          request: new Request("https://app.test/api/v1/proposals/speakers/access/race/headshot"),
          waitUntil: () => {},
          proposalId: proposal.id,
          proposalSpeakerId: speaker.id,
          userId: user.id,
          proposalStatus: proposal.status,
          proposalUpdatedAt: proposal.updated_at,
          currentStatus: speaker.status,
          inviteGeneration: speaker.invite_generation,
          accountHeadshotKey: user.accountHeadshotR2Key,
          proposalOverrideSet: user.proposalHeadshotOverrideSet,
          proposalOverrideKey: user.proposalHeadshotOverrideKey,
        },
        { buffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, contentType: "image/jpeg" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "HEADSHOT_CHANGED" });

    expect(bucket.keys()).toEqual([]);
    await expect(
      queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ headshot_r2_key: null }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'headshot_uploaded_by_speaker'"),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE object_key LIKE 'headshots/%'"),
    ).resolves.toHaveLength(0);
    await expect(queryAll(env.DB, "SELECT id FROM badge_render_jobs")).resolves.toHaveLength(badgeJobsBeforeUpload);
  });

  it("rolls back a self headshot delete when roster authority is revoked before D1 commit", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();
    const { speaker, proposal, user } = await getSpeakerByManageToken(
      env.DB,
      speakerManageToken,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const [{ total: badgeJobsBeforeDelete }] = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM badge_render_jobs",
    );
    const existingKey = `headshots/${user.id}/existing.jpg`;
    const bucket = new FakeUploadsBucket();
    await bucket.put(existingKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(existingKey, user.id).run();

    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE id = ?").bind(speaker.id).run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      removeProposalSpeakerSelfHeadshot({
        db: racingDb,
        env: { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket } as any,
        request: new Request("https://app.test/api/v1/proposals/speakers/access/race/headshot"),
        waitUntil: () => {},
        proposalId: proposal.id,
        proposalSpeakerId: speaker.id,
        userId: user.id,
        proposalStatus: proposal.status,
        proposalUpdatedAt: proposal.updated_at,
        currentStatus: speaker.status,
        inviteGeneration: speaker.invite_generation,
        accountHeadshotKey: existingKey,
        proposalOverrideSet: user.proposalHeadshotOverrideSet,
        proposalOverrideKey: user.proposalHeadshotOverrideKey,
      }),
    ).rejects.toMatchObject({ status: 409, code: "HEADSHOT_CHANGED" });

    await expect(
      queryAll<{ headshot_r2_key: string | null }>(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", user.id),
    ).resolves.toEqual([{ headshot_r2_key: existingKey }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'headshot_deleted_by_speaker'"),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox WHERE object_key = ?", [existingKey]),
    ).resolves.toHaveLength(0);
    await expect(queryAll(env.DB, "SELECT id FROM badge_render_jobs")).resolves.toHaveLength(badgeJobsBeforeDelete);
    expect(await bucket.get(existingKey)).not.toBeNull();
  });

  it("rejects MIME-spoofed headshots through both speaker capability surfaces", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId, speakerManageToken } = await inviteSpeakerAndSubmitProposal();
    const bucket = new FakeUploadsBucket();

    const upload = async (url: string) => {
      const formData = new FormData();
      formData.append("file", new File(["not an image"], "headshot.jpg", { type: "image/jpeg" }));
      return app.fetch(
        new Request(url, { method: "PUT", body: formData }),
        { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );
    };

    const proposerResponse = await upload(
      `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
    );
    const speakerResponse = await upload(
      `https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/headshot`,
    );

    expect(proposerResponse.status).toBe(415);
    expect(speakerResponse.status).toBe(415);
  });

  it("proposal manage reminder requests profile review for confirmed speakers", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId, speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const confirmResponse = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerManageToken}/participation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "confirmed",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );
    expect(confirmResponse.status).toBe(200);

    const remindResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${proposalManageToken}/speakers/${coSpeakerUserId}/reminders`,
        {
          method: "POST",
        },
      ),
      env,
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(remindResponse.status).toBe(200);
    const outboxRows = await queryAll<{ template_key: string; subject: string; payload_json: string }>(
      env.DB,
      "SELECT template_key, subject, payload_json FROM email_outbox ORDER BY created_at DESC LIMIT 1",
    );
    expect(outboxRows[0].template_key).toBe("speaker_profile_request");
    expect(outboxRows[0].subject).toContain("review or update your speaker profile");
    expect(outboxRows[0].payload_json).toContain("profileUrl");
  });

  it("admin remind speaker issues a valid token that the speaker can use", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();

    const remindResponse = await mountedSpeakerRoute(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}/reminders`, {
          method: "POST",
          headers: { authorization: `Bearer ${adminSessionToken}`, "content-type": "application/json" },
          body: JSON.stringify({ kind: "profile" }),
        }),
        { proposalId, userId: coSpeakerUserId },
      ),
    );
    expect(remindResponse.status).toBe(200);

    // Extract the token from the queued email's profileUrl
    const outboxRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox ORDER BY created_at DESC LIMIT 1",
    );
    const payload = await deliveredEmailPayload<{ profileUrl?: string }>(env.DB, env, outboxRows[0].payload_json);
    expect(payload.profileUrl).toBeDefined();
    const profileUrl = new URL(payload.profileUrl!);
    const token = profileUrl.searchParams.get("token");
    expect(token).toBeTruthy();

    // The token from the email must be usable to access the speaker endpoint
    const speakerResponse = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speakers/access/${token}`, { method: "GET" }), {
        token: token!,
      }),
    );
    expect(speakerResponse.status).toBe(200);
  });

  it("routes profile and presentation reminders through the validated admin contracts", async () => {
    await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const workerContext = {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any;
    const adminHeaders = { authorization: `Bearer ${adminSessionToken}` };
    const path = `/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`;

    const profileResponse = await app.fetch(
      new Request(`https://app.test${path}/reminders`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ kind: "profile" }),
      }),
      env,
      workerContext,
    );
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toEqual({ success: true });

    await env.DB.prepare(
      `INSERT INTO proposal_decisions (
         id, proposal_id, decided_by_user_id, final_status, decision_note,
         min_reviews_required, review_count, decided_at
       ) VALUES (?, ?, ?, 'accepted', NULL, 0, 0, datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        proposalId,
        (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0].id,
      )
      .run();

    const presentationResponse = await app.fetch(
      new Request(`https://app.test${path}/reminders`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ kind: "presentation" }),
      }),
      env,
      workerContext,
    );
    expect(presentationResponse.status).toBe(200);
    expect(await presentationResponse.json()).toEqual({ success: true });
  });

  it("rejects malformed speaker reminder identifiers before the mutation service runs", async () => {
    await setupWorkflow();
    const { proposalId } = await inviteSpeakerAndSubmitProposal();
    const workerContext = {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any;
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/not-a-uuid/reminders`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminSessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "profile" }),
      }),
      env,
      workerContext,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("does not let a proposer remind speakers after the proposal is canceled", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);

    await expect(
      remindProposalSpeakerByProposer(env.DB, {
        proposal: { ...proposal, status: "canceled" },
        userId: coSpeakerUserId,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CLOSED" });
  });

  it("does not let an administrator send profile or presentation reminders after cancellation", async () => {
    const { adminUserId } = await setupWorkflow();
    const { proposalId } = await inviteSpeakerAndSubmitProposal();
    await env.DB.prepare("UPDATE session_proposals SET status = 'canceled' WHERE id = ?").bind(proposalId).run();
    const outboxBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");

    for (const kind of ["profile", "presentation"] as const) {
      await expect(
        sendProposalSpeakerReminders(env.DB, {
          proposalId,
          kind,
          actor: { identityType: "user", id: adminUserId, email: "admin@example.test", role: "admin" },
          appBaseUrl: "https://app.test",
        }),
      ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_CLOSED" });
    }
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toHaveLength(outboxBefore.length);
  });

  it("rolls back a proposer reminder email and reminder state when audit fails", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const [before] = await queryAll<{ reminder_count: number }>(
      env.DB,
      "SELECT speaker_invite_reminder_count AS reminder_count FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    const outboxBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");
    await env.DB.prepare(
      `CREATE TRIGGER reject_proposer_reminder_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'co_speaker_reminded_by_proposer'
       BEGIN
         SELECT RAISE(ABORT, 'forced proposer reminder audit failure');
       END`,
    ).run();

    await expect(
      remindProposalSpeakerByProposer(env.DB, {
        proposal,
        userId: coSpeakerUserId,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toThrow("forced proposer reminder audit failure");

    const [after] = await queryAll<{ reminder_count: number }>(
      env.DB,
      "SELECT speaker_invite_reminder_count AS reminder_count FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
      proposalId,
      coSpeakerUserId,
    );
    expect(after.reminder_count).toBe(before.reminder_count);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(outboxBefore.length);
    await env.DB.prepare("DROP TRIGGER reject_proposer_reminder_audit").run();
  });

  it("rolls back a proposer reminder email when the speaker status changes before the D1 batch", async () => {
    await setupWorkflow();
    const { proposalId, proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const outboxBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");
    const baseDb: DatabaseLike = env.DB;
    let raced = false;
    const racingDb: DatabaseLike = {
      prepare: (query) => baseDb.prepare(query),
      async batch(statements) {
        if (!raced) {
          raced = true;
          await baseDb
            .prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
            .bind(proposalId, coSpeakerUserId)
            .run();
        }
        return baseDb.batch(statements);
      },
    };

    await expect(
      remindProposalSpeakerByProposer(racingDb, {
        proposal,
        userId: coSpeakerUserId,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });

    await expect(
      queryAll<{ status: string; reminder_count: number }>(
        env.DB,
        `SELECT status, speaker_invite_reminder_count AS reminder_count
         FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?`,
        [proposalId, coSpeakerUserId],
      ),
    ).resolves.toEqual([{ status: "declined", reminder_count: 0 }]);
    await expect(queryAll(env.DB, "SELECT id FROM email_outbox")).resolves.toHaveLength(outboxBefore.length);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'co_speaker_reminded_by_proposer'"),
    ).resolves.toHaveLength(0);
  });

  it("rolls back an admin reminder email when audit fails", async () => {
    const { adminUserId } = await setupWorkflow();
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const outboxBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");
    await env.DB.prepare(
      `CREATE TRIGGER reject_admin_reminder_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'speaker_profile_request_resent'
       BEGIN
         SELECT RAISE(ABORT, 'forced admin reminder audit failure');
       END`,
    ).run();

    await expect(
      sendProposalSpeakerReminders(env.DB, {
        proposalId,
        userId: coSpeakerUserId,
        kind: "profile",
        actor: { identityType: "user", id: adminUserId, email: "admin@example.test", role: "admin" },
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toThrow("forced admin reminder audit failure");

    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(outboxBefore.length);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'speaker_profile_request_resent'"),
    ).toHaveLength(0);
    await env.DB.prepare("DROP TRIGGER reject_admin_reminder_audit").run();
  });
});

describe("speaker nomination by attendees", () => {
  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function registerAndConfirmAttendee(): Promise<string> {
    await setupWorkflow();

    const regResponse = await mountedSpeakerRoute(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Attendee",
            lastName: "Nominator",
            email: "nominator@pkic.org",
            attendanceType: "in_person",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );
    expect(regResponse.status).toBe(200);
    await regResponse.json();

    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    const emailPayload = await deliveredEmailPayload<{ confirmationUrl: string }>(env.DB, env, outbox[0].payload_json);
    const confirmUrl = new URL(emailPayload.confirmationUrl);
    const confirmToken = confirmUrl.searchParams.get("token") as string;

    const confirmResponse = await mountedSpeakerRoute(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(confirmToken)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
    );
    const confirmPayload = (await confirmResponse.json()) as { manageToken: string };
    return confirmPayload.manageToken;
  }

  async function registerAndConfirmAttendeeDirect(): Promise<string> {
    const { eventId } = await setupWorkflow();
    const attendee = await findOrCreateUser(env.DB, {
      email: `nominator-${crypto.randomUUID()}@pkic.org`,
      firstName: "Attendee",
      lastName: "Nominator",
    });
    const created = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: attendee.id,
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    if (!created.confirmationToken) throw new Error("Expected a registration confirmation token");
    return (
      await confirmRegistrationByToken(env.DB, {
        token: created.confirmationToken,
        waitlistClaimWindowHours: 24,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
      })
    ).manageToken;
  }

  async function postSpeakerNomination(manageToken: string, email: string, expiresAt?: string): Promise<Response> {
    return mountedSpeakerRoute(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/speakers/invitations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${manageToken}`,
          },
          body: JSON.stringify({
            ...(expiresAt ? { expiresAt } : {}),
            invites: [{ email, firstName: "Nominee", lastName: "Speaker" }],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );
  }

  it("allows a registered attendee to nominate a speaker", async () => {
    const manageToken = await registerAndConfirmAttendee();
    const response = await postSpeakerNomination(manageToken, "nominee@example.test");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      created: Array<{ email: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.created).toHaveLength(1);
    expect(body.created[0].email).toBe("nominee@example.test");
    await expect(
      queryAll<{ expires_at: string }>(
        env.DB,
        "SELECT expires_at FROM invites WHERE invitee_email = ? AND invite_type = 'speaker'",
        "nominee@example.test",
      ),
    ).resolves.toEqual([{ expires_at: "2026-12-01T08:00:00.000Z" }]);
    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE recipient_email = ? AND template_key = 'speaker_invite'",
      "nominee@example.test",
    );
    expect(JSON.parse(outbox[0].payload_json)).toMatchObject({
      attendeeName: { __pkicEmailPlainText: "Nominee Speaker" },
    });
  });

  it("accepts a custom speaker nomination deadline within the event window", async () => {
    const manageToken = await registerAndConfirmAttendeeDirect();
    const response = await postSpeakerNomination(
      manageToken,
      "custom-deadline-nominee@example.test",
      "2026-12-02T12:00:00.000Z",
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll<{ expires_at: string }>(
        env.DB,
        "SELECT expires_at FROM invites WHERE invitee_email = ? AND invite_type = 'speaker'",
        "custom-deadline-nominee@example.test",
      ),
    ).resolves.toEqual([{ expires_at: "2026-12-02T12:00:00.000Z" }]);
  });

  it("rejects past and post-event speaker nomination deadlines", async () => {
    const manageToken = await registerAndConfirmAttendeeDirect();
    for (const [label, expiresAt] of [
      ["past", "2026-01-01T00:00:00.000Z"],
      ["after-event", "2026-12-03T18:00:00.001Z"],
    ] as const) {
      const email = `${label}-nominee@example.test`;
      const response = await postSpeakerNomination(manageToken, email, expiresAt);

      expect(response.status).toBe(400);
      await expect(
        queryAll(env.DB, "SELECT id FROM invites WHERE invitee_email = ? AND invite_type = 'speaker'", email),
      ).resolves.toHaveLength(0);
    }
  });

  it("does not insert a peer speaker nomination after a concurrent event schedule change", async () => {
    const manageToken = await registerAndConfirmAttendeeDirect();
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET ends_at = starts_at WHERE slug = 'pqc-2026'").run();
    });
    const racingEnv = { ...env, DB: racingDb } as any;

    await expect(
      createPeerInvitations(
        racingEnv,
        new Request("https://app.test/api/v1/events/pqc-2026/speakers/invitations", {
          headers: { authorization: `Bearer ${manageToken}` },
        }),
        "pqc-2026",
        {
          expiresAt: "2026-12-02T12:00:00.000Z",
          invites: [{ email: "schedule-race-nominee@example.test" }],
        },
        "speaker",
      ),
    ).rejects.toMatchObject({ code: "EVENT_INVITE_WINDOW_CHANGED", status: 409 });
    await expect(
      queryAll(env.DB, "SELECT id FROM invites WHERE invitee_email = 'schedule-race-nominee@example.test'"),
    ).resolves.toHaveLength(0);
  });

  it("rejects speaker nomination without auth token", async () => {
    await setupWorkflow();

    const response = await mountedSpeakerRoute(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/speakers/invitations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invites: [{ email: "nominee@example.test", firstName: "Nominee", lastName: "Speaker" }],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
