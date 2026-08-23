import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { addProposalSpeaker, createProposal } from "../functions/_lib/services/proposals";
import { headshotUploadResponseSchema } from "../assets/shared/schemas/registration";

class FakeUploadsBucket {
  private readonly objects = new Map<string, { body: ArrayBuffer; contentType: string }>();

  async put(key: string, value: ArrayBuffer, options?: Record<string, unknown>): Promise<void> {
    this.objects.set(key, {
      body: value,
      contentType: (options?.httpMetadata as { contentType?: string } | undefined)?.contentType ?? "image/jpeg",
    });
  }

  async get(
    key: string,
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata: { contentType: string } } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { arrayBuffer: async () => object.body, httpMetadata: { contentType: object.contentType } };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function callAdmin(
  token: string,
  proposalId: string,
  userId: string,
  suffix: string,
  init: RequestInit = {},
  bucket = new FakeUploadsBucket(),
): Promise<{ response: Response; bucket: FakeUploadsBucket }> {
  const response = await app.fetch(
    new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/speakers/${userId}/${suffix}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    }),
    { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
  return { response, bucket };
}

async function seedProposalSpeaker(eventId: string): Promise<{ proposalId: string; userId: string }> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
     VALUES (?, ?, ?, 'Scoped', 'Speaker', datetime('now'), datetime('now'))`,
  )
    .bind(userId, `scoped-${userId}@example.test`, `scoped-${userId}@example.test`)
    .run();
  const proposal = await createProposal(env.DB, {
    eventId,
    proposerUserId: userId,
    proposalType: "talk",
    title: "Scoped headshot",
    abstract: "A proposal used to verify scoped administrator headshots.",
  });
  await addProposalSpeaker(env.DB, { proposalId: proposal.proposal.id, userId, role: "proposer" });
  return { proposalId: proposal.proposal.id, userId };
}

describe("admin proposal speaker headshots", () => {
  beforeEach(async () => resetDb());

  it("uploads only to the proposal speaker override and returns a working cache-busted URL", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const { proposalId, userId } = await seedProposalSpeaker(eventId);
    const token = await createAdminSession(env.DB, adminId, "admin-scoped-headshot-upload");
    const bucket = new FakeUploadsBucket();
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "speaker.jpg", { type: "image/jpeg" }));

    const { response } = await callAdmin(token, proposalId, userId, "headshot", { method: "PUT", body: form }, bucket);
    expect(response.status).toBe(200);
    const payload = headshotUploadResponseSchema.parse(await response.json());
    expect(payload.r2Key).toMatch(new RegExp(`^proposal-headshots/${proposalId}/${userId}/`));
    expect(payload.headshotUrl).toContain(`/api/v1/admin/proposals/${proposalId}/speakers/${userId}/headshot`);
    expect(new URL(payload.headshotUrl).searchParams.get("v")).toBeTruthy();

    const [user] = await queryAll<{ headshot_r2_key: string | null }>(
      env.DB,
      "SELECT headshot_r2_key FROM users WHERE id = ?",
      [userId],
    );
    expect(user.headshot_r2_key).toBeNull();

    const { response: getResponse } = await callAdmin(token, proposalId, userId, "headshot", {}, bucket);
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("content-type")).toBe("image/jpeg");
  });

  it("allows a proposal reviewer to read but not mutate a scoped speaker headshot", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { proposalId, userId } = await seedProposalSpeaker(eventId);
    const reviewerId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(reviewerId, `reviewer-${reviewerId}@example.test`, `reviewer-${reviewerId}@example.test`),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, created_at)
         VALUES (?, ?, 'proposals:score', 'event', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), reviewerId, eventId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, created_at)
         VALUES (?, ?, 'proposals:read', 'event', ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), reviewerId, eventId),
      env.DB.prepare(
        `UPDATE proposal_speakers SET headshot_override_set = 1, headshot_r2_key = ?, headshot_updated_at = datetime('now')
         WHERE proposal_id = ? AND user_id = ?`,
      ).bind(`proposal-headshots/${proposalId}/${userId}/existing.jpg`, proposalId, userId),
    ]);
    const token = await createAdminSession(env.DB, reviewerId, "proposal-reviewer-headshot");
    const bucket = new FakeUploadsBucket();
    await bucket.put(`proposal-headshots/${proposalId}/${userId}/existing.jpg`, new Uint8Array([1, 2, 3]).buffer);

    const { response: getResponse } = await callAdmin(token, proposalId, userId, "headshot", {}, bucket);
    expect(getResponse.status).toBe(200);

    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "speaker.jpg", { type: "image/jpeg" }));
    const { response: putResponse } = await callAdmin(
      token,
      proposalId,
      userId,
      "headshot",
      { method: "PUT", body: form },
      bucket,
    );
    expect(putResponse.status).toBe(403);
  });
});
