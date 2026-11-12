// Prepare the real HTTP graph before timed journeys, as the shared API test helper does.
import "../functions/http-router";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { onlyPersona } from "./personas/catalog";
import { queryAll } from "./helpers/context";
import { schedulerJobBacklogResponseSchema, schedulerJobsListResponseSchema } from "../assets/shared/schemas/scheduler";
import { seedEventAndAdmin } from "./helpers/context";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import type { DatabaseLike } from "../functions/_lib/types";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return callWithDatabase(token, path, env.DB, init);
}

async function callWithDatabase(
  token: string | null,
  path: string,
  db: DatabaseLike,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...env, DB: db } as never,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as never,
  );
}

/**
 * A staff identity composed from named profiles, holding exactly what those
 * profiles grant and nothing more. Composing named profiles rather than
 * listing permissions keeps every identity here one the product can issue.
 */
async function staffIdentityWith(personas: string[]) {
  const seeded = await seedPersona(env.DB, personas);
  return { userId: seeded.userId, grantIds: seeded.grantIds, token: seeded.token! };
}

async function staffWith(personas: string[]): Promise<string> {
  return (await staffIdentityWith(personas)).token;
}

describe("scheduler API", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects anonymous access to every scheduler route", async () => {
    for (const [path, method] of [
      ["/api/v1/scheduler/jobs", "GET"],
      ["/api/v1/scheduler/jobs/retention/runs", "POST"],
      ["/api/v1/scheduler/jobs/retention", "PATCH"],
    ] as const) {
      const response = await call(null, path, {
        method,
        ...(method === "PATCH" ? { body: JSON.stringify({ state: "paused", reason: "because" }) } : {}),
        ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("edits a schedule with live permission and a stale-interval guard", async () => {
    const token = await staffWith(["schedulerOperator"]);
    const jobs = schedulerJobsListResponseSchema.parse(await (await call(token, "/api/v1/scheduler/jobs")).json());
    const job = jobs.jobs.find((item) => item.jobKey === "retention")!;
    const path = "/api/v1/scheduler/jobs/retention/schedule";
    const init = {
      method: "PATCH",
      body: JSON.stringify({ intervalSeconds: 120, expectedIntervalSeconds: job.intervalSeconds }),
    };
    expect((await call(null, path, init)).status).toBe(401);
    const reader = await staffWith([onlyPersona("scheduler:read")]);
    expect((await call(reader, path, init)).status).toBe(403);
    expect((await call(token, path, init)).status).toBe(200);
    expect((await call(token, path, init)).status).toBe(409);
    expect(
      (
        await call(token, path, {
          method: "PATCH",
          body: JSON.stringify({ intervalSeconds: 0, expectedIntervalSeconds: 120 }),
        })
      ).status,
    ).toBe(400);
    const updated = schedulerJobsListResponseSchema
      .parse(await (await call(token, "/api/v1/scheduler/jobs")).json())
      .jobs.find((item) => item.jobKey === "retention")!;
    expect(updated.intervalSeconds).toBe(120);
    expect(updated.nextRunAt).toBe(job.nextRunAt);
  });

  it("lists the registry for scheduler:read and reports lease and success state", async () => {
    const token = await staffWith([onlyPersona("scheduler:read")]);
    const response = await call(token, "/api/v1/scheduler/jobs");
    expect(response.status).toBe(200);

    const payload = schedulerJobsListResponseSchema.parse(await response.json());
    const retention = payload.jobs.find((job) => job.jobKey === "retention");
    expect(retention).toBeDefined();
    expect(retention!.lastSuccessAt).toBeNull();
    expect(retention!.leaseExpired).toBe(false);
    expect(retention!.capabilities).toEqual({ manageState: false, run: false, readBacklog: false });
    expect(payload.jobs.map((job) => job.jobKey)).toContain("votes_due_work");
    expect(payload.jobs.map((job) => job.jobKey)).toContain("standing_chair_terms");
    expect(payload.jobs.map((job) => job.jobKey)).toContain("standing_event_speakers");
    expect(payload.jobs.map((job) => job.jobKey)).toContain("sponsor_logo_publication");
  });

  it("searches, sorts, and pages jobs through the shared list query", async () => {
    const token = await staffWith([onlyPersona("scheduler:read")]);
    const firstResponse = await call(token, "/api/v1/scheduler/jobs?limit=2&sort=-job_key");
    expect(firstResponse.status).toBe(200);
    const first = schedulerJobsListResponseSchema.parse(await firstResponse.json());
    expect(first.jobs).toHaveLength(2);
    expect(first.page.offset).toBe(0);
    expect(first.page.hasMore).toBe(true);
    expect(first.jobs[0].jobKey > first.jobs[1].jobKey).toBe(true);

    const nextResponse = await call(token, "/api/v1/scheduler/jobs?limit=2&offset=2&sort=-job_key");
    expect(nextResponse.status).toBe(200);
    const next = schedulerJobsListResponseSchema.parse(await nextResponse.json());
    expect(next.page.offset).toBe(2);
    expect(next.jobs[0]?.jobKey).not.toBe(first.jobs[0].jobKey);

    const searchedResponse = await call(token, "/api/v1/scheduler/jobs?q=retention");
    expect(searchedResponse.status).toBe(200);
    const searched = schedulerJobsListResponseSchema.parse(await searchedResponse.json());
    expect(searched.jobs.map((job) => job.jobKey)).toEqual(["retention"]);
    expect(searched.page.total).toBe(1);
    expect((await call(token, "/api/v1/scheduler/jobs?sort=not_a_column")).status).toBe(400);
  });

  it("derives exact state and run capabilities from the job's live domain grants", async () => {
    const manager = await staffWith(["schedulerOperator"]);
    const managerPayload = schedulerJobsListResponseSchema.parse(
      await (await call(manager, "/api/v1/scheduler/jobs")).json(),
    );
    expect(managerPayload.jobs.find((job) => job.jobKey === "retention")?.capabilities).toEqual({
      manageState: true,
      run: false,
      readBacklog: false,
    });

    const runner = await staffWith(["schedulerOperator", "retentionOperator"]);
    const runnerPayload = schedulerJobsListResponseSchema.parse(
      await (await call(runner, "/api/v1/scheduler/jobs")).json(),
    );
    expect(runnerPayload.jobs.find((job) => job.jobKey === "retention")?.capabilities).toEqual({
      manageState: true,
      run: true,
      readBacklog: false,
    });
    // Only a job that lists its work offers it, and only to a caller holding the job's domain grant.
    const agenda = await staffWith(["schedulerOperator", "agendaEditor"]);
    const agendaPayload = schedulerJobsListResponseSchema.parse(
      await (await call(agenda, "/api/v1/scheduler/jobs?q=promotion")).json(),
    );
    expect(agendaPayload.jobs.find((job) => job.jobKey === "promotion_rendering")?.capabilities.readBacklog).toBe(true);
  });

  it("refuses a run to a caller holding scheduler:manage but not the job's own grants", async () => {
    // The escalation this surface must not permit: retention redacts user data,
    // so triggering it through the scheduler still requires users:anonymize.
    const token = await staffWith(["schedulerOperator"]);
    for (const job of ["retention", "recording_acquisitions", "standing_event_speakers", "sponsor_logo_publication"]) {
      const response = await call(token, `/api/v1/scheduler/jobs/${job}/runs`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(403);
    }
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'scheduled_job_triggered'")).toHaveLength(0);
  });

  it("refuses a run to a caller holding the job's grants but not scheduler:manage", async () => {
    const token = // Holds the retention domain itself but not scheduler:manage, so it must
      // not be able to run retention *through* the scheduler.
      await staffWith([onlyPersona("scheduler:read"), "retentionOperator"]);
    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
  });

  it("runs a job for a caller holding both, and records the trigger", async () => {
    const token = await staffWith(["schedulerOperator", "retentionOperator"]);
    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, jobKey: "retention", status: "succeeded" });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'scheduled_job_triggered' AND entity_id = ?", [
        "retention",
      ]),
    ).toHaveLength(1);
    // The lease must be released, not left holding the job.
    const [row] = await queryAll<{ running_since: string | null; last_status: string }>(
      env.DB,
      "SELECT running_since, last_status FROM scheduled_jobs WHERE job_key = 'retention'",
    );
    expect(row.running_since).toBeNull();
    expect(row.last_status).toBe("succeeded");
  });

  it("takes over a run whose lease expired instead of reporting it as running", async () => {
    const token = await staffWith(["schedulerOperator", "retentionOperator"]);
    await env.DB.prepare(
      `UPDATE scheduled_jobs
          SET running_since = '2026-01-01T00:00:00.000Z', lease_expires_at = '2026-01-01T00:05:00.000Z', run_token = 'dead-run'
        WHERE job_key = 'retention'`,
    ).run();

    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const [row] = await queryAll<{ running_since: string | null; last_status: string; consecutive_abandoned: number }>(
      env.DB,
      "SELECT running_since, last_status, consecutive_abandoned FROM scheduled_jobs WHERE job_key = 'retention'",
    );
    expect(row).toMatchObject({ running_since: null, last_status: "succeeded", consecutive_abandoned: 0 });
  });

  it("lists the promotion job's unfinished work only for a caller holding its domain grant", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const user = await findOrCreateUser(env.DB, {
      email: "backlog@example.test",
      firstName: "Ada",
      lastName: "Example",
    });
    const at = "2026-01-01T00:00:00.000Z";
    await env.DB.batch([
      // A render whose Worker died, and an email that waits for that file.
      env.DB.prepare(
        `INSERT INTO event_promotion_renders(id,event_id,occurrence_id,user_id,revision,format,origin,cache_key,status,next_attempt_at,lease_expires_at,created_at,updated_at)
         VALUES ('render-1',?,NULL,?,1,'carousel','https://app.test','key-1','rendering',?,?,?,?)`,
      ).bind(eventId, user.id, at, at, at, at),
      env.DB.prepare(
        `INSERT INTO event_promotion_batches(id,event_id,requested_by,published_revision,formats_json,origin,created_at)
         VALUES ('batch-1',?,?,1,'["carousel"]','https://app.test',?)`,
      ).bind(eventId, user.id, at),
      env.DB.prepare(
        `INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,status,next_attempt_at,updated_at,email_status)
         VALUES ('batch-1',NULL,?,'prepared',?,?,'pending')`,
      ).bind(user.id, at, at),
    ]);
    const path = "/api/v1/scheduler/jobs/promotion_rendering/backlog?sort=typeLabel";

    expect((await call(await staffWith(["schedulerOperator"]), path)).status).toBe(403);
    const response = await call(await staffWith(["schedulerOperator", "agendaEditor"]), path);
    expect(response.status).toBe(200);
    const body = schedulerJobBacklogResponseSchema.parse(await response.json());
    expect(body.page.total).toBe(2);
    expect(body.items.map((item) => [item.typeLabel, item.title, item.context, item.statusLabel])).toEqual([
      ["Email", "Ada Example", "Attendee kit · Carousel", "Waiting for files"],
      ["File", "Ada Example", "Attendee kit · Carousel", "Interrupted"],
    ]);
    // A job without a backlog has no such page.
    expect(
      (
        await call(
          await staffWith(["schedulerOperator", "retentionOperator"]),
          "/api/v1/scheduler/jobs/retention/backlog",
        )
      ).status,
    ).toBe(404);
  });

  it("returns 404 for an unknown job rather than leaking the registry shape", async () => {
    const token = await staffWith(["schedulerOperator"]);
    const response = await call(token, "/api/v1/scheduler/jobs/not-a-job/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);
  });

  it("pauses with an attributed reason, refuses to run while paused, and resumes", async () => {
    const token = await staffWith(["schedulerOperator", "retentionOperator"]);

    const paused = await call(token, "/api/v1/scheduler/jobs/retention", {
      method: "PATCH",
      body: JSON.stringify({ state: "paused", reason: "investigating a redaction defect" }),
    });
    expect(paused.status).toBe(200);
    await expect(paused.json()).resolves.toMatchObject({
      job: { pausedReason: "investigating a redaction defect" },
    });

    const blocked = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(blocked.status).toBe(409);

    const resumed = await call(token, "/api/v1/scheduler/jobs/retention", {
      method: "PATCH",
      body: JSON.stringify({ state: "active" }),
    });
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({ job: { pausedAt: null, pausedReason: null } });

    const [audit] = await queryAll<{ actions: string }>(
      env.DB,
      `SELECT group_concat(action) AS actions FROM audit_log
        WHERE entity_type = 'scheduled_job' AND entity_id = 'retention'`,
    );
    expect(audit.actions).toContain("scheduled_job_paused");
    expect(audit.actions).toContain("scheduled_job_resumed");
  });

  it("does not let a pause be recorded without a reason", async () => {
    const token = await staffWith(["schedulerOperator"]);
    const response = await call(token, "/api/v1/scheduler/jobs/retention", {
      method: "PATCH",
      body: JSON.stringify({ state: "paused" }),
    });
    expect(response.status).toBe(400);
  });

  it("removes the superseded pause and resume action routes", async () => {
    const token = await staffWith(["schedulerOperator"]);
    for (const path of ["/api/v1/scheduler/jobs/retention/pause", "/api/v1/scheduler/jobs/retention/resume"]) {
      expect((await call(token, path, { method: "POST", body: JSON.stringify({ reason: "legacy" }) })).status).toBe(
        404,
      );
    }
  });

  it("rolls back a state update when scheduler authority is revoked before commit", async () => {
    const identity = await staffIdentityWith(["schedulerOperator"]);
    const racedDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /^\s*(?:INSERT|UPDATE|DELETE)/u.test(sql),
      () =>
        env.DB.prepare("UPDATE permission_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
          .bind(identity.grantIds.get("scheduler:manage"))
          .run(),
    );
    const response = await callWithDatabase(identity.token, "/api/v1/scheduler/jobs/retention", racedDb, {
      method: "PATCH",
      body: JSON.stringify({ state: "paused", reason: "must not commit" }),
    });

    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("SCHEDULER_AUTHORIZATION_CHANGED");
    expect(await queryAll(env.DB, "SELECT paused_at FROM scheduled_jobs WHERE job_key = 'retention'")).toEqual([
      { paused_at: null },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'scheduled_job_paused' AND entity_id = 'retention'",
      ),
    ).toHaveLength(0);
  });

  it("rolls back a manual claim when a job-domain grant is revoked before commit", async () => {
    const identity = await staffIdentityWith(["schedulerOperator", "retentionOperator"]);
    const racedDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => /^\s*(?:INSERT|UPDATE|DELETE)/u.test(sql),
      () =>
        env.DB.prepare("UPDATE permission_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
          .bind(identity.grantIds.get("users:anonymize"))
          .run(),
    );
    const response = await callWithDatabase(identity.token, "/api/v1/scheduler/jobs/retention/runs", racedDb, {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("SCHEDULER_AUTHORIZATION_CHANGED");
    expect(await queryAll(env.DB, "SELECT running_since FROM scheduled_jobs WHERE job_key = 'retention'")).toEqual([
      { running_since: null },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'scheduled_job_triggered' AND entity_id = 'retention'",
      ),
    ).toHaveLength(0);
  });
});
