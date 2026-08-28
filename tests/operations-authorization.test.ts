import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { Permission } from "../assets/shared/schemas/permissions";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import {
  runMembershipBatchCommand,
  runReminderCommand,
  runRetentionCommand,
} from "../functions/_lib/services/operations";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

function call(path: string, token: string, body?: Record<string, unknown>): Promise<Response> {
  return callApi(env, path, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

async function createStaff(
  permissions: readonly Permission[],
  context?: { type: string; id: string },
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`)
    .run();
  for (const permission of permissions) {
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), id, permission, context?.type ?? null, context?.id ?? null)
      .run();
  }
  return { id, token: await createAdminSession(env.DB, id, `operations-${id}`) };
}

describe("canonical email and operations authorization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("allows read-only projections and preview but denies every mutation", async () => {
    await seedEventAndAdmin(env.DB);
    const { token } = await createStaff(["email:read", "operations:read"]);

    expect((await call("/api/v1/email/outbox", token)).status).toBe(200);
    expect((await call("/api/v1/operations/due-work", token)).status).toBe(200);
    expect((await call("/api/v1/operations/reminders/preview", token, { limit: 1 })).status).toBe(200);
    expect((await call("/api/v1/email/outbox/process", token, { limit: 1 })).status).toBe(403);
    expect((await call("/api/v1/operations/reminders/run", token, { limit: 1 })).status).toBe(403);
    expect((await call("/api/v1/operations/retention/run", token, {})).status).toBe(403);
  });

  it("requires read as a companion to action permissions", async () => {
    await seedEventAndAdmin(env.DB);
    const { token } = await createStaff(["email:manage", "operations:run", "users:anonymize"]);

    expect((await call("/api/v1/email/outbox/process", token, { limit: 1 })).status).toBe(403);
    expect((await call("/api/v1/operations/retention/run", token, {})).status).toBe(403);
  });

  it("enforces the extra permission for each high-impact command", async () => {
    await seedEventAndAdmin(env.DB);
    const base = await createStaff(["operations:read", "operations:run"]);

    expect((await call("/api/v1/operations/reminders/run", base.token, { limit: 1 })).status).toBe(200);
    expect((await call("/api/v1/operations/membership-batches/wg-chair-digest/run", base.token, {})).status).toBe(200);
    expect((await call("/api/v1/operations/retention/run", base.token, {})).status).toBe(403);
    expect((await call("/api/v1/operations/membership-batches/consultation/run", base.token, {})).status).toBe(403);
    expect((await call("/api/v1/operations/membership-batches/ec-review/run", base.token, {})).status).toBe(403);

    const retention = await createStaff(["operations:read", "operations:run", "users:anonymize"]);
    const consultation = await createStaff(["operations:read", "operations:run", "membership:write"]);
    const ecReview = await createStaff(["operations:read", "operations:run", "membership:approve"]);
    expect((await call("/api/v1/operations/retention/run", retention.token, {})).status).toBe(200);
    expect((await call("/api/v1/operations/membership-batches/consultation/run", consultation.token, {})).status).toBe(
      200,
    );
    expect((await call("/api/v1/operations/membership-batches/ec-review/run", ecReview.token, {})).status).toBe(200);
  });

  it("denies service API keys and contextual grants on every canonical staff boundary", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const contextual = await createStaff(
      ["email:read", "email:manage", "operations:read", "operations:run", "users:anonymize"],
      { type: "event", id: eventId },
    );
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    const requests: Array<[string, Record<string, unknown> | undefined]> = [
      ["/api/v1/email/outbox", undefined],
      ["/api/v1/operations/due-work", undefined],
      ["/api/v1/email/outbox/process", { limit: 1 }],
      ["/api/v1/email/outbox/reset-failed", { ids: [crypto.randomUUID()] }],
      ["/api/v1/operations/reminders/preview", { limit: 1 }],
      ["/api/v1/operations/reminders/run", { limit: 1 }],
      ["/api/v1/operations/retention/run", {}],
    ];

    for (const [path, body] of requests) {
      expect((await call(path, apiKey, body)).status, `API key at ${path}`).toBe(403);
      expect((await call(path, contextual.token, body)).status, `contextual grant at ${path}`).toBe(403);
    }
  });

  it("attributes manual command intent and outcome to the acting user", async () => {
    await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const token = await createAdminSession(env.DB, adminId, "operations-audit-token");

    expect((await call("/api/v1/operations/retention/run", token, {})).status).toBe(200);
    expect(
      await queryAll<{ actor_type: string; actor_id: string; action: string }>(
        env.DB,
        `SELECT actor_type, actor_id, action
         FROM audit_log
         WHERE action LIKE 'operations_retention_%'
         ORDER BY rowid ASC`,
      ),
    ).toEqual([
      { actor_type: "admin", actor_id: adminId, action: "operations_retention_requested" },
      { actor_type: "admin", actor_id: adminId, action: "operations_retention_completed" },
    ]);
  });

  it.each([
    [
      "reminders",
      (db: typeof env.DB, actor: ReturnType<typeof createUserBackedAuthAdmin>) =>
        runReminderCommand(db, env as any, new Request("https://app.test/api/v1/operations/reminders/run"), actor, 1),
    ],
    [
      "retention",
      (db: typeof env.DB, actor: ReturnType<typeof createUserBackedAuthAdmin>) => runRetentionCommand(db, actor),
    ],
    [
      "consultation",
      (db: typeof env.DB, actor: ReturnType<typeof createUserBackedAuthAdmin>) =>
        runMembershipBatchCommand(db, env as any, actor, "consultation"),
    ],
    [
      "EC review",
      (db: typeof env.DB, actor: ReturnType<typeof createUserBackedAuthAdmin>) =>
        runMembershipBatchCommand(db, env as any, actor, "ec-review"),
    ],
    [
      "chair digest",
      (db: typeof env.DB, actor: ReturnType<typeof createUserBackedAuthAdmin>) =>
        runMembershipBatchCommand(db, env as any, actor, "wg-chair-digest"),
    ],
  ] as const)(
    "rolls back the %s command when a required permission is revoked before its first batch",
    async (_name, run) => {
      await seedEventAndAdmin(env.DB);
      const operator = await createStaff([
        "operations:read",
        "operations:run",
        "users:anonymize",
        "membership:write",
        "membership:approve",
      ]);
      const actor = createUserBackedAuthAdmin({
        id: operator.id,
        email: `${operator.id}@example.test`,
        role: "user",
        grants: ["operations:read", "operations:run", "users:anonymize", "membership:write", "membership:approve"].map(
          (permission) => ({ permission, contextType: null, contextId: null }),
        ),
      });
      const racedDb = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare(
          "UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ? AND permission = 'operations:run'",
        )
          .bind(operator.id)
          .run(),
      );

      await expect(run(racedDb as typeof env.DB, actor)).rejects.toMatchObject({
        status: 409,
        code: "OPERATIONS_AUTHORIZATION_CHANGED",
      });
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE actor_id = ?", [operator.id])).toEqual([]);
    },
  );

  it("unmounts every superseded admin and internal operations route", async () => {
    await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const token = await createAdminSession(env.DB, adminId, "removed-operations-routes");
    for (const [path, body] of [
      ["/api/v1/admin/email/outbox", undefined],
      ["/api/v1/admin/due-work", undefined],
      ["/api/v1/internal/email/retry", {}],
      ["/api/v1/internal/email/reset-failed", {}],
      ["/api/v1/internal/jobs/run", {}],
      ["/api/v1/internal/reminders/run", {}],
      ["/api/v1/internal/retention/run", {}],
    ] satisfies Array<[string, Record<string, unknown> | undefined]>) {
      expect((await call(path, token, body)).status, path).toBe(404);
    }
  });
});
