import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import {
  issueDatabaseCapability,
  materializeQueuedCapabilityLinks,
  signCapabilityToken,
} from "../functions/_lib/services/capability-links";
import { run } from "../functions/_lib/db/queries";
import { getProposalByManageToken } from "../functions/_lib/services/proposals";
import { nowIso } from "../functions/_lib/utils/time";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";

const signingSecret = "proposal-resend-test-signing-secret";

describe("proposal resend-manage-link endpoint", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("queues fresh links for matching active proposals without invalidating earlier links", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const now = nowIso();
    const proposerId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    await run(
      env.DB,
      `INSERT INTO users (
        id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, 'Proposal', 'Owner', 'user', 1, ?, ?)`,
      [proposerId, "proposal-owner@example.test", "proposal-owner@example.test", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        manage_link_secret, submitted_at, updated_at
      ) VALUES (?, ?, ?, 'submitted', 'talk', 'Recoverable proposal', 'Abstract', ?, ?, ?)`,
      [proposalId, eventId, proposerId, "stable-proposal-secret", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO proposal_speakers (
        id, proposal_id, user_id, role, status, manage_link_secret, created_at
      ) VALUES (?, ?, ?, 'proposer', 'confirmed', NULL, ?)`,
      [crypto.randomUUID(), proposalId, proposerId, now],
    );
    const earlierToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "proposal_manage",
      resourceId: proposalId,
    });
    const testEnv = { ...env, INTERNAL_SIGNING_SECRET: signingSecret };

    const response = await callApi(testEnv, "/api/v1/events/pqc-2026/proposals/resend-manage-link", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.40" },
      body: JSON.stringify({ email: "proposal-owner@example.test" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    const queued = (
      await queryAll<{ subject: string; payload_json: string }>(
        env.DB,
        "SELECT subject, payload_json FROM email_outbox WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1",
        "proposal-owner@example.test",
      )
    )[0];
    expect(queued.subject).toContain("Your proposal management link");
    const delivered = await materializeQueuedCapabilityLinks(
      env.DB,
      testEnv,
      JSON.parse(queued.payload_json) as Record<string, unknown>,
    );
    const freshToken = new URL(delivered.manageUrl as string).searchParams.get("token")!;

    await expect(getProposalByManageToken(env.DB, earlierToken, signingSecret)).resolves.toMatchObject({
      id: proposalId,
    });
    await expect(getProposalByManageToken(env.DB, freshToken, signingSecret)).resolves.toMatchObject({
      id: proposalId,
    });
  });

  it("returns the same success response when no proposal matches", async () => {
    await seedEventAndAdmin(env.DB);
    const response = await callApi(
      { ...env, INTERNAL_SIGNING_SECRET: signingSecret },
      "/api/v1/events/pqc-2026/proposals/resend-manage-link",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.41" },
        body: JSON.stringify({ email: "missing@example.test" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("does not recover proposer or speaker management links for a canceled proposal", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const now = nowIso();
    const proposerId = crypto.randomUUID();
    const speakerId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    await run(
      env.DB,
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'canceled-owner@example.test', 'canceled-owner@example.test', 'user', 1, ?, ?),
              (?, 'canceled-speaker@example.test', 'canceled-speaker@example.test', 'user', 1, ?, ?)`,
      [proposerId, now, now, speakerId, now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
         id, event_id, proposer_user_id, status, proposal_type, title, abstract,
         manage_link_secret, submitted_at, updated_at
       ) VALUES (?, ?, ?, 'canceled', 'talk', 'Canceled proposal', 'Abstract', ?, ?, ?)`,
      [proposalId, eventId, proposerId, "stable-proposal-secret", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO proposal_speakers (
         id, proposal_id, user_id, role, status, manage_link_secret, created_at
       ) VALUES (?, ?, ?, 'speaker', 'confirmed', ?, ?)`,
      [crypto.randomUUID(), proposalId, speakerId, "stable-speaker-secret", now],
    );
    const testEnv = { ...env, INTERNAL_SIGNING_SECRET: signingSecret };

    const proposerResponse = await callApi(testEnv, "/api/v1/events/pqc-2026/proposals/resend-manage-link", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.42" },
      body: JSON.stringify({ email: "canceled-owner@example.test" }),
    });
    const speakerResponse = await callApi(testEnv, "/api/v1/events/pqc-2026/proposals/resend-speaker-manage-link", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.43" },
      body: JSON.stringify({ email: "canceled-speaker@example.test" }),
    });

    expect(proposerResponse.status).toBe(200);
    expect(speakerResponse.status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("does not recover an expired pending speaker invitation but keeps confirmed speaker recovery available", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    await seedWorkflowEmailTemplates(env.DB, admin.id);
    const now = nowIso();
    const proposerId = crypto.randomUUID();
    const expiredSpeakerId = crypto.randomUUID();
    const confirmedSpeakerId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    await run(
      env.DB,
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'recovery-owner@example.test', 'recovery-owner@example.test', 'user', 1, ?, ?),
              (?, 'expired-speaker@example.test', 'expired-speaker@example.test', 'user', 1, ?, ?),
              (?, 'confirmed-speaker@example.test', 'confirmed-speaker@example.test', 'user', 1, ?, ?)`,
      [proposerId, now, now, expiredSpeakerId, now, now, confirmedSpeakerId, now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
         id, event_id, proposer_user_id, status, proposal_type, title, abstract,
         manage_link_secret, submitted_at, updated_at
       ) VALUES (?, ?, ?, 'submitted', 'talk', 'Speaker recovery', 'Abstract', ?, ?, ?)`,
      [proposalId, eventId, proposerId, "stable-proposal-secret", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO proposal_speakers (
         id, proposal_id, user_id, role, status, manage_link_secret, invite_expires_at, created_at
       ) VALUES (?, ?, ?, 'speaker', 'invited', ?, '2026-08-26T00:00:00.000Z', ?),
                (?, ?, ?, 'speaker', 'confirmed', ?, '2026-08-26T00:00:00.000Z', ?)`,
      [
        crypto.randomUUID(),
        proposalId,
        expiredSpeakerId,
        "expired-speaker-secret",
        now,
        crypto.randomUUID(),
        proposalId,
        confirmedSpeakerId,
        "confirmed-speaker-secret",
        now,
      ],
    );
    const testEnv = { ...env, INTERNAL_SIGNING_SECRET: signingSecret };

    for (const [email, ip] of [
      ["expired-speaker@example.test", "203.0.113.44"],
      ["confirmed-speaker@example.test", "203.0.113.45"],
    ] as const) {
      const response = await callApi(testEnv, "/api/v1/events/pqc-2026/proposals/resend-speaker-manage-link", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ email }),
      });
      expect(response.status).toBe(200);
    }

    await expect(
      queryAll<{ recipient_email: string }>(
        env.DB,
        "SELECT recipient_email FROM email_outbox WHERE template_key = 'co_speaker_invite' ORDER BY recipient_email",
      ),
    ).resolves.toEqual([{ recipient_email: "confirmed-speaker@example.test" }]);
  });

  it("rejects an expired proposal management capability", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const now = nowIso();
    const proposerId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const linkSecret = "expired-proposal-link-secret";
    await run(
      env.DB,
      `INSERT INTO users (
        id, email, normalized_email, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, 'user', 1, ?, ?)`,
      [proposerId, "expired-proposal@example.test", "expired-proposal@example.test", now, now],
    );
    await run(
      env.DB,
      `INSERT INTO session_proposals (
        id, event_id, proposer_user_id, status, proposal_type, title, abstract,
        manage_link_secret, submitted_at, updated_at
      ) VALUES (?, ?, ?, 'submitted', 'talk', 'Expired proposal', 'Abstract', ?, ?, ?)`,
      [proposalId, eventId, proposerId, linkSecret, now, now],
    );
    const token = await signCapabilityToken({
      signingSecret,
      linkSecret,
      purpose: "proposal_manage",
      resourceId: proposalId,
      ttlSeconds: 1,
      nowSeconds: Math.floor(Date.now() / 1000) - 2,
    });

    const response = await callApi(
      { ...env, INTERNAL_SIGNING_SECRET: signingSecret },
      `/api/v1/proposals/access/${encodeURIComponent(token)}`,
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_TOKEN_EXPIRED" } });
  });
});
