import { ADMINISTRATOR_FIXTURE_USER_SQL } from "./helpers/administrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { validJpegBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";
import { addProposalSpeaker, createProposal } from "../functions/_lib/services/proposals";

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

describe("proposal speaker headshots", () => {
  beforeEach(async () => resetDb());
  afterEach(() => vi.unstubAllGlobals());

  it("serves the speaker their own person headshot through their speaker link", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const { userId, speakerToken } = await seedProposalSpeaker(eventId);
    const assets = new FakeUploadsBucket();
    const importedKey = "member-photos/example/speaker.jpg";
    await assets.put(importedKey, validJpegBytes().buffer);
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(importedKey, userId).run();
    const read = () =>
      app.fetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${encodeURIComponent(speakerToken)}/headshot`),
        { ...env, ASSETS_BUCKET: assets, SPEAKER_UPLOADS_BUCKET: new FakeUploadsBucket() } as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );
    const inherited = await read();
    expect(inherited.status).toBe(200);
    expect(inherited.headers.get("content-type")).toBe("image/jpeg");
    expect(inherited.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await inherited.arrayBuffer())).toEqual(new Uint8Array(validJpegBytes()));
    await env.DB.prepare("UPDATE users SET headshot_r2_key = NULL WHERE id = ?").bind(userId).run();
    expect((await read()).status).toBe(404);
  });

  it("keeps no proposal-scoped headshot to read or write: the headshot is the person's own", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const { proposalId, userId, proposerToken } = await seedProposalSpeaker(eventId);
    const token = await createAdminSession(env.DB, adminId, "admin-scoped-headshot-upload");
    const bucket = new FakeUploadsBucket();
    const form = new FormData();
    form.append("file", new File([validJpegBytes()], "speaker.jpg", { type: "image/jpeg" }));

    for (const init of [
      {},
      { method: "PUT", body: form },
      { method: "DELETE" },
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "gravatar" }) },
    ]) {
      const { response } = await callAdmin(token, proposalId, userId, "headshot", init, bucket);
      expect([404, 405]).toContain(response.status);
      const proposer = await app.fetch(
        new Request(
          `https://app.test/api/v1/proposals/access/${encodeURIComponent(proposerToken)}/speakers/${userId}/headshot`,
          init,
        ),
        { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );
      expect([401, 404, 405]).toContain(proposer.status);
    }
    expect(await queryAll(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", [userId])).toEqual([
      { headshot_r2_key: null },
    ]);
  });
});
