import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReferralCode } from "../functions/_lib/services/referrals";
import app from "../functions/router";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  processBadgeRenderJobById,
  processPendingBadgeRenders,
  requestRegistrationBadgeRegeneration,
  seedGravatarAndProcessBadgeRenderJob,
} from "../functions/_lib/services/registration-badge-regeneration";
import { prepareBadgeRenderJob } from "../functions/_lib/services/badge-render-job-statements";
import type { AuthAdmin, Env } from "../functions/_lib/types";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { eventRegistrationBadgeRegenerationResponseSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";
import { fetchGravatar } from "../functions/_lib/services/gravatar";
import { validJpegBytes } from "./helpers/raster-images";

const env = workerEnv as unknown as Env;

async function seedRegistrationWithReferral(): Promise<{
  actor: AuthAdmin;
  event: Awaited<ReturnType<typeof getEventBySlug>>;
  registrationId: string;
  referralCode: string;
  userId: string;
}> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES (?, 'badge@example.test', 'badge@example.test', 'Badge', 'Owner', datetime('now'), datetime('now'))`,
    ).bind(userId),
    env.DB.prepare(
      `INSERT INTO registrations (
           id, event_id, user_id, status, attendance_type, source_type,
           manage_link_secret, created_at, updated_at
         ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
    ).bind(registrationId, eventId, userId, crypto.randomUUID()),
  ]);
  const referralCode = await createReferralCode(env.DB, {
    eventId,
    ownerType: "registration",
    ownerId: registrationId,
    length: 7,
  });
  const [admin] = await queryAll<{ id: string; email: string; role: string }>(
    env.DB,
    "SELECT id, email, role FROM users WHERE normalized_email = 'admin@pkic.org'",
  );
  return {
    actor: { identityType: "user", ...admin },
    event: await getEventBySlug(env.DB, "pqc-2026"),
    registrationId,
    referralCode,
    userId,
  };
}

describe("registration badge regeneration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("atomically queues badge invalidation when first-time Gravatar seeding changes the headshot", async () => {
    const seeded = await seedRegistrationWithReferral();
    const stored = new Map<string, ArrayBuffer>();
    const bucket = {
      put: async (key: string, value: ArrayBuffer) => {
        stored.set(key, value);
        return { size: value.byteLength };
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
    } as unknown as R2Bucket;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validJpegBytes(), { headers: { "content-type": "image/jpeg" } })),
    );

    const r2Key = await fetchGravatar(seeded.userId, "badge@example.test", {
      DB: env.DB,
      SPEAKER_UPLOADS_BUCKET: bucket,
    });

    expect(r2Key).toBeTruthy();
    expect(stored.has(r2Key!)).toBe(true);
    expect(await queryAll(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", seeded.userId)).toEqual([
      { headshot_r2_key: r2Key },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id, status FROM badge_render_jobs WHERE referral_code = ?", seeded.referralCode),
    ).toEqual([{ id: `badge:${seeded.referralCode}`, status: "queued" }]);
    expect(
      await queryAll(env.DB, "SELECT actor_type, action FROM audit_log WHERE entity_id = ?", seeded.userId),
    ).toEqual([{ actor_type: "system", action: "headshot_seeded_gravatar" }]);
    expect(await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox WHERE object_key = ?", r2Key!)).toHaveLength(
      0,
    );
  });

  it("cleans up a speculative Gravatar when another headshot wins the pointer race", async () => {
    const seeded = await seedRegistrationWithReferral();
    const stored = new Map<string, ArrayBuffer>();
    const winnerKey = `headshots/${seeded.userId}/winner.jpg`;
    const bucket = {
      put: async (key: string, value: ArrayBuffer) => {
        stored.set(key, value);
        await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(winnerKey, seeded.userId).run();
        return { size: value.byteLength };
      },
      delete: async (key: string) => {
        stored.delete(key);
      },
    } as unknown as R2Bucket;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validJpegBytes(), { headers: { "content-type": "image/jpeg" } })),
    );

    await expect(
      fetchGravatar(seeded.userId, "badge@example.test", {
        DB: env.DB,
        SPEAKER_UPLOADS_BUCKET: bucket,
      }),
    ).resolves.toBeNull();

    expect(stored.size).toBe(0);
    expect(await queryAll(env.DB, "SELECT headshot_r2_key FROM users WHERE id = ?", seeded.userId)).toEqual([
      { headshot_r2_key: winnerKey },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM badge_render_jobs WHERE referral_code = ?", seeded.referralCode),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'headshot_seeded_gravatar' AND entity_id = ?", [
        seeded.userId,
      ]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox")).toEqual([]);
  });

  it("atomically records an audited render intent before executing the R2 effect", async () => {
    const seeded = await seedRegistrationWithReferral();
    const requested = await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://app.test",
    });

    const jobs = await queryAll<{ id: string; referral_code: string; status: string }>(
      env.DB,
      "SELECT id, referral_code, status FROM badge_render_jobs",
    );
    expect(jobs).toEqual([{ id: requested.jobId, referral_code: seeded.referralCode, status: "queued" }]);
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_type = 'registration' AND entity_id = ?",
        seeded.registrationId,
      ),
    ).toEqual([{ action: "og_badge_regeneration_requested" }]);

    const render = vi.fn().mockResolvedValue(undefined);
    await expect(processBadgeRenderJobById(env.DB, env, requested.jobId, render)).resolves.toBe(true);
    expect(render).toHaveBeenCalledWith(seeded.referralCode, env, "https://app.test");
    expect(await queryAll<{ status: string }>(env.DB, "SELECT status FROM badge_render_jobs")).toEqual([
      { status: "rendered" },
    ]);
  });

  it("mounts the canonical event resource with the shared response contract", async () => {
    const seeded = await seedRegistrationWithReferral();
    const token = await createAdminSession(env.DB, seeded.actor.id, "badge-regeneration-admin-token");
    const background: Promise<unknown>[] = [];

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${seeded.registrationId}/badge`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      {
        passThroughOnException() {},
        waitUntil(promise) {
          background.push(promise);
        },
      } as ExecutionContext,
    );

    expect(response.status).toBe(202);
    expect(eventRegistrationBadgeRegenerationResponseSchema.parse(await response.json())).toMatchObject({
      success: true,
      status: "queued",
      referralCode: seeded.referralCode,
      badgeUrl: `https://app.test/api/v1/og/${seeded.referralCode}`,
    });
    expect(background).toHaveLength(1);
    await Promise.allSettled(background);
    expect(
      await queryAll(env.DB, "SELECT id FROM badge_render_jobs WHERE referral_code = ?", seeded.referralCode),
    ).toHaveLength(1);
  });

  it("retries failed rendering without deleting the previous cached object", async () => {
    const seeded = await seedRegistrationWithReferral();
    const requested = await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://app.test",
    });
    const render = vi.fn().mockRejectedValueOnce(new Error("R2 unavailable")).mockResolvedValueOnce(undefined);

    await expect(processBadgeRenderJobById(env.DB, env, requested.jobId, render)).resolves.toBe(false);
    expect(await queryAll(env.DB, "SELECT status, attempts, last_error FROM badge_render_jobs")).toEqual([
      { status: "retrying", attempts: 1, last_error: "R2 unavailable" },
    ]);

    await env.DB.prepare("UPDATE badge_render_jobs SET next_attempt_at = datetime('now')").run();
    await expect(processPendingBadgeRenders(env.DB, env, 5, render)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(await queryAll(env.DB, "SELECT status, attempts, last_error FROM badge_render_jobs")).toEqual([
      { status: "rendered", attempts: 1, last_error: null },
    ]);
  });

  it("keeps an initial render intent retryable when eager background rendering fails", async () => {
    const seeded = await seedRegistrationWithReferral();
    const job = prepareBadgeRenderJob(env.DB, seeded.referralCode);
    await env.DB.batch([job.statement]);
    const render = vi.fn().mockRejectedValue(new Error("initial R2 failure"));

    await expect(
      seedGravatarAndProcessBadgeRenderJob(
        env.DB,
        env,
        { userId: seeded.userId, email: "badge@example.test", jobId: job.id },
        render,
      ),
    ).resolves.toBe(false);

    expect(
      await queryAll(env.DB, "SELECT status, attempts, last_error FROM badge_render_jobs WHERE id = ?", job.id),
    ).toEqual([{ status: "retrying", attempts: 1, last_error: "initial R2 failure" }]);
  });

  it("rolls back the render intent when its audit record cannot be committed", async () => {
    const seeded = await seedRegistrationWithReferral();
    await env.DB.prepare(
      `CREATE TRIGGER reject_badge_regeneration_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'og_badge_regeneration_requested'
       BEGIN
         SELECT RAISE(ABORT, 'forced badge audit failure');
       END`,
    ).run();

    try {
      await expect(
        requestRegistrationBadgeRegeneration(env.DB, {
          actor: seeded.actor,
          event: seeded.event,
          registrationId: seeded.registrationId,
          appBaseUrl: "https://app.test",
        }),
      ).rejects.toThrow("forced badge audit failure");
      expect(await queryAll(env.DB, "SELECT id FROM badge_render_jobs")).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_badge_regeneration_audit").run();
    }
  });

  it("claims a queued render only once under concurrent delivery", async () => {
    const seeded = await seedRegistrationWithReferral();
    const requested = await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://app.test",
    });
    const render = vi.fn().mockResolvedValue(undefined);

    const outcomes = await Promise.all([
      processBadgeRenderJobById(env.DB, env, requested.jobId, render),
      processBadgeRenderJobById(env.DB, env, requested.jobId, render),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("preserves a newer invalidation that arrives while an older generation renders", async () => {
    const seeded = await seedRegistrationWithReferral();
    const requested = await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://app.test",
    });
    let finishRender!: () => void;
    const render = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRender = resolve;
        }),
    );

    const firstRender = processBadgeRenderJobById(env.DB, env, requested.jobId, render);
    await vi.waitFor(async () => {
      expect(await queryAll(env.DB, "SELECT status FROM badge_render_jobs WHERE id = ?", requested.jobId)).toEqual([
        { status: "rendering" },
      ]);
    });
    await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://ignored-at-processing.test",
    });
    finishRender();
    await expect(firstRender).resolves.toBe(true);

    expect(
      await queryAll(env.DB, "SELECT status, requested_generation, claimed_generation FROM badge_render_jobs"),
    ).toEqual([{ status: "queued", requested_generation: 2, claimed_generation: null }]);

    const secondRender = vi.fn().mockResolvedValue(undefined);
    await expect(processPendingBadgeRenders(env.DB, env, 1, secondRender)).resolves.toEqual({
      processed: 1,
      failed: 0,
    });
    expect(secondRender).toHaveBeenCalledWith(seeded.referralCode, env, "https://app.test");
    expect(await queryAll(env.DB, "SELECT status, requested_generation FROM badge_render_jobs")).toEqual([
      { status: "rendered", requested_generation: 2 },
    ]);
  });

  it("recovers an expired render lease without stealing a live lease", async () => {
    const seeded = await seedRegistrationWithReferral();
    const requested = await requestRegistrationBadgeRegeneration(env.DB, {
      actor: seeded.actor,
      event: seeded.event,
      registrationId: seeded.registrationId,
      appBaseUrl: "https://app.test",
    });
    const render = vi.fn().mockResolvedValue(undefined);
    await env.DB.prepare(
      `UPDATE badge_render_jobs
          SET status = 'rendering', processing_token = 'current', claimed_generation = requested_generation,
              lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes')
        WHERE id = ?`,
    )
      .bind(requested.jobId)
      .run();
    await processPendingBadgeRenders(env.DB, env, 10, render);
    expect(render).not.toHaveBeenCalled();

    await env.DB.prepare(
      "UPDATE badge_render_jobs SET lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute') WHERE id = ?",
    )
      .bind(requested.jobId)
      .run();
    await expect(processPendingBadgeRenders(env.DB, env, 10, render)).resolves.toEqual({ processed: 1, failed: 0 });
    expect(render).toHaveBeenCalledTimes(1);
  });
});
