import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedPersona } from "./personas/seed";
import { onlyPersona } from "./personas/catalog";
import { queryAll } from "./helpers/context";
import { schedulerJobsListResponseSchema } from "../assets/shared/schemas/scheduler";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import type { DatabaseLike } from "../functions/_lib/types";
import { mutateBeforeNextBatch } from "./helpers/database-races";

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

  it("lists the registry for scheduler:read and reports lease and success state", async () => {
    const token = await staffWith([onlyPersona("scheduler:read")]);
    const response = await call(token, "/api/v1/scheduler/jobs");
    expect(response.status).toBe(200);

    const payload = schedulerJobsListResponseSchema.parse(await response.json());
    const retention = payload.jobs.find((job) => job.jobKey === "retention");
    expect(retention).toBeDefined();
    expect(retention!.lastSuccessAt).toBeNull();
    expect(retention!.leaseExpired).toBe(false);
    expect(retention!.capabilities).toEqual({ manageState: false, run: false });
    expect(payload.jobs.map((job) => job.jobKey)).toContain("votes_due_work");
  });

  it("derives exact state and run capabilities from the job's live domain grants", async () => {
    const manager = await staffWith(["schedulerOperator"]);
    const managerPayload = schedulerJobsListResponseSchema.parse(
      await (await call(manager, "/api/v1/scheduler/jobs")).json(),
    );
    expect(managerPayload.jobs.find((job) => job.jobKey === "retention")?.capabilities).toEqual({
      manageState: true,
      run: false,
    });

    const runner = await staffWith(["schedulerOperator", "retentionOperator"]);
    const runnerPayload = schedulerJobsListResponseSchema.parse(
      await (await call(runner, "/api/v1/scheduler/jobs")).json(),
    );
    expect(runnerPayload.jobs.find((job) => job.jobKey === "retention")?.capabilities).toEqual({
      manageState: true,
      run: true,
    });
  });

  it("refuses a run to a caller holding scheduler:manage but not the job's own grants", async () => {
    // The escalation this surface must not permit: retention redacts user data,
    // so triggering it through the scheduler still requires users:anonymize.
    const token = await staffWith(["schedulerOperator"]);
    const response = await call(token, "/api/v1/scheduler/jobs/retention/runs", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
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
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
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
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
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
