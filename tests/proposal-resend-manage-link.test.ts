import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { onRequestPost as resendProposalManageLink } from "../functions/api/v1/events/[eventSlug]/proposals/resend-manage-link";
import app from "../functions/router";
import {
  issueDatabaseCapability,
  materializeQueuedCapabilityLinks,
  signCapabilityToken,
} from "../functions/_lib/services/capability-links";
import { run } from "../functions/_lib/db/queries";
import { getProposalByManageToken } from "../functions/_lib/services/proposals";
import { nowIso } from "../functions/_lib/utils/time";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { resetDb } from "./helpers/reset-db";

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

    const response = await resendProposalManageLink(
      createContext(
        testEnv,
        new Request("https://app.test/api/v1/events/pqc-2026/proposals/resend-manage-link", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.40" },
          body: JSON.stringify({ email: "proposal-owner@example.test" }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

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
    const response = await resendProposalManageLink(
      createContext(
        { ...env, INTERNAL_SIGNING_SECRET: signingSecret },
        new Request("https://app.test/api/v1/events/pqc-2026/proposals/resend-manage-link", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.41" },
          body: JSON.stringify({ email: "missing@example.test" }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
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

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/manage/${encodeURIComponent(token)}`),
      { ...env, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_TOKEN_EXPIRED" } });
  });
});
