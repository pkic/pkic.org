import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReferralCode } from "../functions/_lib/services/referrals";
import app from "../functions/router";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  processBadgeRenderJobById,
  processPendingBadgeRenders,
  requestRegistrationBadgeRegeneration,
} from "../functions/_lib/services/registration-badge-regeneration";
import type { AuthAdmin, Env } from "../functions/_lib/types";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { badgeRegenerationQueuedResponseSchema } from "../assets/shared/schemas/route-contracts";

const env = workerEnv as unknown as Env;

async function seedRegistrationWithReferral(): Promise<{
  actor: AuthAdmin;
  event: Awaited<ReturnType<typeof getEventBySlug>>;
  registrationId: string;
  referralCode: string;
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
    actor: admin,
    event: await getEventBySlug(env.DB, "pqc-2026"),
    registrationId,
    referralCode,
  };
}

describe("registration badge regeneration", () => {
  beforeEach(async () => {
    await resetDb();
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

  it("mounts the admin endpoint with the shared response contract", async () => {
    const seeded = await seedRegistrationWithReferral();
    const token = await createAdminSession(env.DB, seeded.actor.id, "badge-regeneration-admin-token");
    const background: Promise<unknown>[] = [];

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/admin/events/pqc-2026/registrations/${seeded.registrationId}/regenerate-badge`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        },
      ),
      env,
      {
        passThroughOnException() {},
        waitUntil(promise) {
          background.push(promise);
        },
      } as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(badgeRegenerationQueuedResponseSchema.parse(await response.json())).toMatchObject({
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
});
