import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { validJpegBytes, validPngBytes } from "./helpers/raster-images";
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
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata: { contentType: string }; size: number } | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      arrayBuffer: async () => object.body,
      httpMetadata: { contentType: object.contentType },
      size: object.body.byteLength,
    };
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
    new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${userId}/${suffix}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    }),
    { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
  return { response, bucket };
}

async function seedProposalSpeaker(
  eventId: string,
): Promise<{ proposalId: string; userId: string; proposerToken: string; speakerToken: string }> {
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
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    abstract: "A proposal used to verify scoped administrator headshots.",
  });
  const speaker = await addProposalSpeaker(env.DB, {
    proposalId: proposal.proposal.id,
    userId,
    role: "proposer",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  return {
    proposalId: proposal.proposal.id,
    userId,
    proposerToken: proposal.manageToken,
    speakerToken: speaker.manageToken,
  };
}

describe("admin proposal speaker headshots", () => {
  beforeEach(async () => resetDb());
  afterEach(() => vi.unstubAllGlobals());

  it.each(["admin", "proposer", "speaker"] as const)(
    "serves inherited imported portraits and scoped overrides to the %s",
    async (actor) => {
      const { eventId } = await seedEventAndAdmin(env.DB);
      const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
      const { proposalId, userId, proposerToken, speakerToken } = await seedProposalSpeaker(eventId);
      const adminToken = await createAdminSession(env.DB, adminId, "admin-imported-headshot");
      const assets = new FakeUploadsBucket();
      const uploads = new FakeUploadsBucket();
      const importedKey = "member-photos/example/speaker.jpg";
      const scopedKey = `proposal-headshots/${proposalId}/${userId}/override.jpg`;
      await assets.put(importedKey, validJpegBytes().buffer);
      await uploads.put(scopedKey, validPngBytes().buffer, { httpMetadata: { contentType: "image/png" } });
      await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(importedKey, userId).run();
      const pathname =
        actor === "admin"
          ? `/api/v1/proposals/${proposalId}/speakers/${userId}/headshot`
          : actor === "proposer"
            ? `/api/v1/proposals/access/${encodeURIComponent(proposerToken)}/speakers/${userId}/headshot`
            : `/api/v1/proposals/speakers/access/${encodeURIComponent(speakerToken)}/headshot`;
      const read = () =>
        app.fetch(
          new Request(`https://app.test${pathname}`, {
            headers: actor === "admin" ? { authorization: `Bearer ${adminToken}` } : {},
          }),
          { ...env, ASSETS_BUCKET: assets, SPEAKER_UPLOADS_BUCKET: uploads } as any,
          { passThroughOnException: () => {}, waitUntil: () => {} } as any,
        );
      const inherited = await read();
      expect(inherited.status).toBe(200);
      expect(inherited.headers.get("content-type")).toBe("image/jpeg");
      expect(inherited.headers.get("cache-control")).toContain("no-store");
      expect(new Uint8Array(await inherited.arrayBuffer())).toEqual(new Uint8Array(validJpegBytes()));
      await env.DB.prepare(
        "UPDATE proposal_speakers SET headshot_override_set = 1, headshot_r2_key = ? WHERE proposal_id = ? AND user_id = ?",
      )
        .bind(scopedKey, proposalId, userId)
        .run();
      const overridden = await read();
      expect(overridden.status).toBe(200);
      expect(overridden.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await overridden.arrayBuffer())).toEqual(new Uint8Array(validPngBytes()));
      await env.DB.prepare("UPDATE proposal_speakers SET headshot_r2_key = NULL WHERE proposal_id = ? AND user_id = ?")
        .bind(proposalId, userId)
        .run();
      expect((await read()).status).toBe(404);
    },
  );

  it("uploads only to the proposal speaker override and returns a working cache-busted URL", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const { proposalId, userId } = await seedProposalSpeaker(eventId);
    const token = await createAdminSession(env.DB, adminId, "admin-scoped-headshot-upload");
    const bucket = new FakeUploadsBucket();
    const form = new FormData();
    form.append("file", new File([validJpegBytes()], "speaker.jpg", { type: "image/jpeg" }));

    const { response } = await callAdmin(token, proposalId, userId, "headshot", { method: "PUT", body: form }, bucket);
    expect(response.status).toBe(200);
    const payload = headshotUploadResponseSchema.parse(await response.json());
    expect(payload.r2Key).toMatch(new RegExp(`^proposal-headshots/${proposalId}/${userId}/`));
    expect(payload.headshotUrl).toContain(`/api/v1/proposals/${proposalId}/speakers/${userId}/headshot`);
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

  it("imports only a validated Gravatar into the proposal-scoped headshot override", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const { proposalId, userId } = await seedProposalSpeaker(eventId);
    const token = await createAdminSession(env.DB, adminId, "admin-scoped-headshot-gravatar");
    const bucket = new FakeUploadsBucket();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validJpegBytes(), { headers: { "content-type": "image/jpeg" } })),
    );

    const { response } = await callAdmin(
      token,
      proposalId,
      userId,
      "headshot",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "gravatar" }),
      },
      bucket,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { r2Key: string };
    expect(payload.r2Key).toMatch(new RegExp(`^proposal-headshots/${proposalId}/${userId}/`));
    expect(
      await queryAll<{ headshot_r2_key: string | null }>(
        env.DB,
        "SELECT headshot_r2_key FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, userId],
      ),
    ).toEqual([{ headshot_r2_key: payload.r2Key }]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validPngBytes(4097, 1), { headers: { "content-type": "image/png" } })),
    );
    const { response: rejected } = await callAdmin(
      token,
      proposalId,
      userId,
      "headshot",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "gravatar" }),
      },
      bucket,
    );
    expect(rejected.status).toBe(404);
    expect(
      await queryAll<{ headshot_r2_key: string | null }>(
        env.DB,
        "SELECT headshot_r2_key FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
        [proposalId, userId],
      ),
    ).toEqual([{ headshot_r2_key: payload.r2Key }]);
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
    await bucket.put(`proposal-headshots/${proposalId}/${userId}/existing.jpg`, validJpegBytes().buffer);

    const { response: getResponse } = await callAdmin(token, proposalId, userId, "headshot", {}, bucket);
    expect(getResponse.status).toBe(200);

    const form = new FormData();
    form.append("file", new File([validJpegBytes()], "speaker.jpg", { type: "image/jpeg" }));
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
