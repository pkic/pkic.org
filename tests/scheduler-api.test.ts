import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { schedulerJobsListResponseSchema } from "../assets/shared/schemas/scheduler";
import type { Permission } from "../assets/shared/schemas/permissions";

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    env as never,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as never,
  );
}

/** A staff user holding exactly the listed grants and nothing more. */
async function staffWith(grants: Permission[], label: string): Promise<string> {
  const userId = await insertUser(env.DB, `${label}@example.test`);
  for (const permission of grants) {
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(userId, permission)
      .run();
  }
  return createAdminSession(env.DB, userId, `${label}-token`);
}

describe("scheduler API", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects anonymous access to every scheduler route", async () => {
    for (const [path, method] of [
      ["/api/v1/scheduler/jobs", "GET"],
      ["/api/v1/scheduler/jobs/retention/runs", "POST"],
      ["/api/v1/scheduler/jobs/retention/pause", "POST"],
    ] as const) {
      const response = await call(null, path, {
        method,
        ...(method === "POST" ? { body: JSON.stringify({ reason: "because" }) } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("lists the registry for scheduler:read and reports lease and success state", async () => {
    const token = await staffWith(["scheduler:read"], "scheduler-reader");
    const response = await call(token, "/api/v1/scheduler/jobs");
    expect(response.status).toBe(200);

    const payload = schedulerJobsListResponseSchema.parse(await response.json());
    const retention = payload.jobs.find((job) => job.jobKey === "retention");
    expect(retention).toBeDefined();
    expect(retention!.lastSuccessAt).toBeNull();
    expect(retention!.leaseExpired).toBe(false);
    expect(payload.jobs.map((job) => job.jobKey)).toContain("votes_due_work");
  });

  it("refuses a run to a caller holding scheduler:manage but not the job's own grants", async () => {
    // The escalation this surface must not permit: retention redacts user data,
    // so triggering it through the scheduler still requires users:anonymize.
    const token = await staffWith(["scheduler:read", "scheduler:manage"], "scheduler-only");
    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'scheduled_job_triggered'")).toHaveLength(0);
  });

  it("refuses a run to a caller holding the job's grants but not scheduler:manage", async () => {
    const token = await staffWith(["scheduler:read", "retention:run", "users:anonymize"], "domain-only");
    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
  });

  it("runs a job for a caller holding both, and records the trigger", async () => {
    const token = await staffWith(
      ["scheduler:read", "scheduler:manage", "retention:run", "users:anonymize"],
      "scheduler-runner",
    );
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

  it("returns 404 for an unknown job rather than leaking the registry shape", async () => {
    const token = await staffWith(["scheduler:read", "scheduler:manage"], "scheduler-unknown");
    const response = await call(token, "/api/v1/scheduler/jobs/not-a-job/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(404);
  });

  it("pauses with an attributed reason, refuses to run while paused, and resumes", async () => {
    const token = await staffWith(
      ["scheduler:read", "scheduler:manage", "retention:run", "users:anonymize"],
      "scheduler-pauser",
    );

    const paused = await call(token, "/api/v1/scheduler/jobs/retention/pause", {
      method: "POST",
      body: JSON.stringify({ reason: "investigating a redaction defect" }),
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

    const resumed = await call(token, "/api/v1/scheduler/jobs/retention/resume", { method: "POST" });
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
    const token = await staffWith(["scheduler:read", "scheduler:manage"], "scheduler-noreason");
    const response = await call(token, "/api/v1/scheduler/jobs/retention/pause", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});
