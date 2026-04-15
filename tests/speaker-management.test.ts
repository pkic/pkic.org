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
import { onRequestPost as submitProposal } from "../functions/api/v1/events/[eventSlug]/proposals";
import { addProposalSpeaker } from "../functions/_lib/services/proposals";
import { onRequestGet as speakerGet } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as speakerPost } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPatch as speakerPatch } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestGet as confirmRegistrationEmail } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequestPost as speakerInvites } from "../functions/api/v1/events/[eventSlug]/speaker-invites";
import { findOrCreateUser } from "../functions/_lib/services/users";

let fetchMock: ReturnType<typeof vi.fn>;
let adminSessionToken: string;

async function setupWorkflow() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminUser = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
  await seedWorkflowEmailTemplates(env.DB, adminUser.id);
  await createAdminSession(env.DB, adminUser.id, "test-admin-token");
  adminSessionToken = "test-admin-token";
  return { eventId, adminUserId: adminUser.id };
}

async function inviteSpeakerAndSubmitProposal(): Promise<{ speakerManageToken: string; proposalId: string }> {
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
  const { created } = await inviteResponse.json() as { created: Array<{ inviteToken: string }> };
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
  const { proposalId } = await proposalResponse.json() as { proposalId: string };

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

  return { speakerManageToken, proposalId };
}

describe("speaker self-management endpoints", () => {
  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET returns speaker participation status and proposal details", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerGet(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
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
      createContext(
        env,
        new Request("https://app.test/api/v1/proposals/speaker/bogus-token"),
        { token: "bogus-token" },
      ),
    );

    expect(response.status).toBe(404);
    const body = await response.json() as { error: { code: string; message: string } };
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
    const body = await response.json() as { success: boolean; status: string };
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
    const body = await response.json() as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe("declined");
  });

  it("PATCH updates speaker profile (bio + links)", async () => {
    await setupWorkflow();
    const { speakerManageToken } = await inviteSpeakerAndSubmitProposal();

    const response = await speakerPatch(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            biography: "Updated bio with post-quantum expertise.",
            links: [
              { label: "LinkedIn", url: "https://linkedin.com/in/speaker" },
            ],
          }),
        }),
        { token: speakerManageToken },
      ),
    );

    expect(response.status).toBe(200);

    // Verify the profile was updated
    const getResponse = await speakerGet(
      createContext(
        env,
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerManageToken}`),
        { token: speakerManageToken },
      ),
    );
    const profile = await getResponse.json() as { profile: { biography: string } };
    expect(profile.profile.biography).toBe("Updated bio with post-quantum expertise.");
  });
});

describe("speaker nomination by attendees", () => {
  beforeEach(async () => {
    await resetDb();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }),
    );
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
            email: "nominator@example.test",
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
        new Request(`https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(confirmToken)}`),
        { eventSlug: "pqc-2026" },
      ),
    );
    const confirmPayload = await confirmResponse.json() as { manageToken: string };
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
    const body = await response.json() as {
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
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
