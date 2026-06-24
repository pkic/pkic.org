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
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { onRequestPost as inviteSpeakersBulk } from "../functions/api/v1/admin/events/[eventSlug]/invites/speakers/bulk";
import { onRequestPost as adminRemindSpeaker } from "../functions/api/v1/admin/proposals/[proposalId]/speakers/[userId]/remind";
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";
import { addProposalSpeaker } from "../functions/_lib/services/proposals";
import { onRequestGet as speakerGet } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as speakerPost } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPatch as speakerPatch } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestGet as confirmRegistrationEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPost as speakerInvites } from "../functions/api/v1/events/[eventSlug]/speaker-invites";
import { findOrCreateUser } from "../functions/_lib/services/users";
import app from "../functions/router";

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
          invites: [{ email: "speaker@example.test", firstName: "Speaker", lastName: "Test", sourceType: "direct" }],
        }),
      }),
      { eventSlug: "pqc-2026" },
    ),
  );
  expect(inviteResponse.status).toBe(200);
  const { created } = (await inviteResponse.json()) as { created: Array<{ inviteToken: string }> };
  const inviteToken = created[0].inviteToken;

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
            links: [{ label: "LinkedIn", url: "https://linkedin.com/in/speaker" }],
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
      };
    };
    expect(profile.profile.firstName).toBe("Updated");
    expect(profile.profile.lastName).toBe("Speaker");
    expect(profile.profile.organizationName).toBe("Quantum Labs");
    expect(profile.profile.jobTitle).toBe("Principal Researcher");
    expect(profile.profile.biography).toBe("Updated bio with post-quantum expertise.");
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
          links: [{ label: "GitHub", url: "https://github.com/casey" }],
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
      }>;
    };
    const speaker = payload.speakers.find((entry) => entry.userId === coSpeakerUserId);
    expect(speaker).toMatchObject({
      firstName: "Casey",
      lastName: "Cryptographer",
      organizationName: "PKIC Labs",
      jobTitle: "Senior Engineer",
      bio: "Provided by the proposer.",
    });
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
    const payload = JSON.parse(outboxRows[0].payload_json) as { profileUrl?: string };
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
    const emailPayload = JSON.parse(outbox[0].payload_json) as { confirmationUrl: string };
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
