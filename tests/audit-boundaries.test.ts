import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

let adminToken: string;

async function call(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${adminToken}`);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(new Request(`https://app.test${path}`, { ...init, headers }), env, {
    passThroughOnException: () => {},
    waitUntil: () => {},
  } as any);
}

async function rejectAuditAction(action: string): Promise<void> {
  await env.DB.prepare("DROP TRIGGER IF EXISTS reject_test_audit").run();
  await env.DB.prepare(
    `CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_log
     WHEN NEW.action = '${action}'
     BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
  ).run();
}

describe("atomic service audit boundaries", () => {
  beforeEach(async () => {
    await env.DB.prepare("DROP TRIGGER IF EXISTS reject_test_audit").run();
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminToken = await createAdminSession(env.DB, admin.id, "audit-boundary-admin");
  });

  it("commits event creation and its audit record together", async () => {
    const success = await call("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({ slug: "audited-event", name: "Audited event", timezone: "UTC" }),
    });
    expect(success.status).toBe(201);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'event_created' AND entity_id = (SELECT id FROM events WHERE slug = 'audited-event')",
      ),
    ).toHaveLength(1);

    await rejectAuditAction("event_created");
    const failed = await call("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({ slug: "rolled-back-event", name: "Rolled back event", timezone: "UTC" }),
    });
    expect(failed.status).toBe(500);
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = 'rolled-back-event'")).toHaveLength(0);
  });

  it("rolls back group mailing-list creation when its audit insert fails", async () => {
    await rejectAuditAction("mailing_list_created");
    const response = await call("/api/v1/groups/20000000-0000-4000-8000-000000000001/mailing-lists", {
      method: "POST",
      body: JSON.stringify({
        email: "audit-rollback@lists.pkic.org",
        label: "Audit rollback",
        purpose: "custom",
      }),
    });
    expect(response.status).toBe(500);
    expect(
      await queryAll(env.DB, "SELECT id FROM mailing_lists WHERE email = 'audit-rollback@lists.pkic.org'"),
    ).toHaveLength(0);
  });

  it("rolls back membership-setting changes when their audit insert fails", async () => {
    await rejectAuditAction("membership_settings_updated");
    const [current] = await queryAll<{ revision: number }>(
      env.DB,
      "SELECT revision FROM membership_settings WHERE id = 'default'",
    );
    const response = await call("/api/v1/system/membership-settings", {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: current.revision, consultationWindowDays: 31 }),
    });
    expect(response.status).toBe(500);
    const [settings] = await queryAll<{ consultation_window_days: number }>(
      env.DB,
      "SELECT consultation_window_days FROM membership_settings WHERE id = 'default'",
    );
    expect(settings.consultation_window_days).toBe(7);
  });
});
