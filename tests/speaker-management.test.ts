/**
 * speaker-management.test.ts
 *
 * Covers:
 *  - GET  /api/v1/proposals/speaker/:token       (speaker self-view)
 *  - POST /api/v1/proposals/speaker/:token       (confirm / decline)
 *  - PATCH /api/v1/proposals/speaker/:token       (update profile)
 *  - POST /api/v1/events/:slug/speaker-invites   (attendee nominates speakers)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, deliveredEmailPayload, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { onRequestPost as inviteSpeakersBulk } from "../functions/api/v1/admin/events/[eventSlug]/invites/speakers/bulk";
import { onRequestPost as previewSpeakerInvites } from "../functions/api/v1/admin/events/[eventSlug]/invites/speakers/preview";
import { onRequestPost as adminRemindSpeaker } from "../functions/api/v1/admin/proposals/[proposalId]/speakers/[userId]/remind";
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";
import { addProposalSpeaker, getProposalByManageToken } from "../functions/_lib/services/proposals";
import { inviteProposalSpeaker } from "../functions/_lib/services/proposal-speaker-management";
import { getEventBySlug } from "../functions/_lib/services/events";
import { onRequestGet as speakerGet } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as speakerPost } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPatch as speakerPatch } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestGet as confirmRegistrationEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPost as speakerInvites } from "../functions/api/v1/events/[eventSlug]/speaker-invites";
import { findOrCreateUser } from "../functions/_lib/services/users";
import app from "../functions/router";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import {
  remindProposalSpeakerByProposer,
  sendAdminProposalSpeakerReminders,
} from "../functions/_lib/services/proposal-reminders";

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
  ): Promise<void> {
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
}

let fetchMock: ReturnType<typeof vi.fn>;
let adminSessionToken: string;

async function setupWorkflow() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminUser = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
  await seedWorkflowEmailTemplates(env.DB, adminUser.id);
  adminSessionToken = await createAdminSession(env.DB, adminUser.id, "test-admin-token");
  return { eventId, adminUserId: adminUser.id };
}

async function inviteSpeakerAndSubmitProposal(): Promise<{
  speakerManageToken: string;
  proposalId: string;
  coSpeakerUserId: string;
  proposalManageToken: string;
}> {
  // Invite a speaker via admin
  const invites = [{ email: "speaker@example.test", firstName: "Speaker", lastName: "Test", sourceType: "direct" }];
  const previewResponse = await previewSpeakerInvites(
    createContext(
      env,
      new Request("https://app.test/api/v1/admin/events/pqc-2026/invites/speakers/preview", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: JSON.stringify({ invites }),
      }),
      { eventSlug: "pqc-2026" },
    ),
  );
  const preview = (await previewResponse.json()) as { previewToken: string; inviteDigest: string };
  const inviteResponse = await inviteSpeakersBulk(
    createContext(
      env,
      new Request("https://app.test/api/v1/admin/events/pqc-2026/invites/speakers/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({
          invites,
          previewToken: preview.previewToken,
          inviteDigest: preview.inviteDigest,
        }),
      }),
      { eventSlug: "pqc-2026" },
    ),
  );
  expect(inviteResponse.status).toBe(200);
  await inviteResponse.json();
  const invite = (
    await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM invites WHERE invitee_email = ? AND invite_type = 'speaker' ORDER BY created_at DESC LIMIT 1",
      "speaker@example.test",
    )
  )[0];
  const inviteToken = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "invite",
    resourceId: invite.id,
  });

  // Submit a proposal with the invite
  const proposalResponse = await submitProposal(
    createContext(
      env,
      new Request("https://app.test/api/v1/events/pqc-2026/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteToken,
          proposer: {
            firstName: "Speaker",
            lastName: "Test",
            email: "speaker@example.test",
            organizationName: "Test Corp",
            jobTitle: "Engineer",
            bio: "Experienced speaker in post-quantum cryptography.",
          },
          proposal: {
            type: "talk",
            title: "Post-Quantum Migration Strategies",
            abstract:
              "A practical guide to migrating enterprise PKI to quantum-safe algorithms covering risk assessment, dual-stack rollout, and governance frameworks.",
          },
          consents: [{ termKey: "speaker-terms", version: "v1" }],
        }),
      }),
      { eventSlug: "pqc-2026" },
    ),
  );
  expect(proposalResponse.status).toBe(200);
  const { proposalId, manageToken } = (await proposalResponse.json()) as { proposalId: string; manageToken: string };

  // Get the proposer's user ID
  const users = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'speaker@example.test' LIMIT 1",
  );
  expect(users.length).toBe(1);

  // The proposer is already added as a speaker with role "proposer" during
  // proposal submission. We can't get the raw token from the DB (it's hashed).
  // Instead, create a fresh speaker entry for an additional co-speaker user
  // so we can test the speaker management endpoint with their known token.
  const coSpeakerUser = await findOrCreateUser(env.DB, {
    email: "cospeaker@example.test",
    firstName: "Co",
    lastName: "Speaker",
    organizationName: "Co Corp",
    jobTitle: "CTO",
  });
  const { manageToken: speakerManageToken } = await addProposalSpeaker(env.DB, {
    proposalId,
    userId: coSpeakerUser.id,
    role: "co_speaker",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });

  return { speakerManageToken, proposalId, coSpeakerUserId: coSpeakerUser.id, proposalManageToken: manageToken };
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
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerGet(
      createContext(env, new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`), {
        token: speakerManageToken,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      speaker: { role: string; status: string };
      proposal: { title: string; status: string };
      profile: { firstName: string; email: string };
    };
    expect(body.speaker.role).toBeTruthy();
    expect(body.proposal.title).toBe("Post-Quantum Migration Strategies");
    expect(body.profile.firstName).toBe("Co");
    expect(body.profile.email).toBe("cospeaker@example.test");
  });

  it("GET rejects an invalid manage token", async () => {
    await setupWorkflow();

    const response = await speakerGet(
      createContext(env, new Request("https://app.test/api/v1/proposals/speaker/bogus-token"), {
        token: "bogus-token",
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SPEAKER_TOKEN_NOT_FOUND");
  });

  it("POST confirm — confirms speaker participation with required consents", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "decline",
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

  it("PATCH updates speaker profile fields", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPatch(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
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
      createContext(env, new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`), {
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
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

  it("proposal manage token updates speaker profile fields", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
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

    const manageGet = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${proposalManageToken}`),
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
      new Request(`https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}`, {
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
      new Request(`https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers`, {
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

    const [speaker] = await queryAll<{ id: string; status: string; invite_generation: number }>(
      env.DB,
      `SELECT id, status, invite_generation FROM proposal_speakers
       WHERE proposal_id = ? AND user_id = ?`,
      proposalId,
      invitedUser.id,
    );
    expect(speaker).toMatchObject({ status: "invited", invite_generation: 0 });
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "decline", reason: "Not available" }),
        }),
        { token: speakerManageToken },
      ),
    );
    expect(declineResponse.status).toBe(200);

    const reinvite = await invite();
    expect(reinvite.outboxId).not.toBe(firstInvite.outboxId);
    const [reinvitedSpeaker] = await queryAll<{ status: string; invite_generation: number }>(
      env.DB,
      "SELECT status, invite_generation FROM proposal_speakers WHERE id = ?",
      speaker.id,
    );
    expect(reinvitedSpeaker).toEqual({ status: "invited", invite_generation: 1 });
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
    const { proposalManageToken, coSpeakerUserId } = await inviteSpeakerAndSubmitProposal();
    const bucket = new FakeUploadsBucket();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "headshot.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    const uploadResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
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
      `/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
    );
    expect(uploadPayload.r2Key.startsWith(`headshots/${coSpeakerUserId}/`)).toBe(true);

    const serveResponse = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
      ),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(serveResponse.status).toBe(200);
    expect(serveResponse.headers.get("content-type")).toBe("image/jpeg");
  });

  it("speaker manage token uploads and serves a speaker headshot", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();
    const bucket = new FakeUploadsBucket();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "headshot.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", file);

    const uploadResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}/headshot`, {
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

    const serveResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}/headshot`),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(serveResponse.status).toBe(200);
    expect(serveResponse.headers.get("content-type")).toBe("image/jpeg");
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
      `https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/${coSpeakerUserId}/headshot`,
    );
    const speakerResponse = await upload(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}/headshot`);

    expect(proposerResponse.status).toBe(415);
    expect(speakerResponse.status).toBe(415);
  });

  it("proposal manage reminder requests profile review for confirmed speakers", async () => {
    await setupWorkflow();
    const { proposalManageToken, coSpeakerUserId, speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const confirmResponse = await speakerPost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirm",
            consents: [{ termKey: "speaker-terms", version: "v1" }],
          }),
        }),
        { token: speakerManageToken },
      ),
    );
    expect(confirmResponse.status).toBe(200);

    const remindResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${proposalManageToken}/speakers/remind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: coSpeakerUserId }),
      }),
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

    const remindResponse = await adminRemindSpeaker(
      createContext(
        env,
        new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${coSpeakerUserId}/remind`, {
          method: "POST",
          headers: { authorization: `Bearer ${adminSessionToken}` },
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
      createContext(env, new Request(`https://app.test/api/v1/proposals/speaker/${token}`, { method: "GET" }), {
        token: token!,
      }),
    );
    expect(speakerResponse.status).toBe(200);
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
      sendAdminProposalSpeakerReminders(env.DB, {
        proposalId,
        userId: coSpeakerUserId,
        kind: "profile",
        actorUserId: adminUserId,
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

    const regResponse = await createRegistration(
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

    // Get confirmation token from outbox and confirm
    const outbox = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
    );
    const emailPayload = await deliveredEmailPayload<{ confirmationUrl: string }>(env.DB, env, outbox[0].payload_json);
    const confirmUrl = new URL(emailPayload.confirmationUrl);
    const confirmToken = confirmUrl.searchParams.get("token") as string;

    const confirmResponse = await confirmRegistrationEmail(
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

  it("allows a registered attendee to nominate a speaker", async () => {
    const manageToken = await registerAndConfirmAttendee();

    const response = await speakerInvites(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/speaker-invites", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${manageToken}`,
          },
          body: JSON.stringify({
            invites: [{ email: "nominee@example.test", firstName: "Nominee", lastName: "Speaker" }],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      created: Array<{ email: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.created).toHaveLength(1);
    expect(body.created[0].email).toBe("nominee@example.test");
  });

  it("rejects speaker nomination without auth token", async () => {
    await setupWorkflow();

    const response = await speakerInvites(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/speaker-invites", {
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
