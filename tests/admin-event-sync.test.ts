import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

const syncPayload = {
  event: {
    slug: "synced-event",
    name: "Synced Event",
    timezone: "Europe/Amsterdam",
    registrationMode: "open",
    frontend: { routes: { registration: "/events/synced-event/register/" } },
  },
  terms: {
    attendee: [{ termKey: "privacy-policy", version: "v2", contentRef: "/privacy/" }],
    speaker: [{ termKey: "speaker-terms", version: "v2", contentRef: "/speaker-terms/" }],
  },
};

async function callSync(token: string): Promise<Response> {
  return app.fetch(
    new Request("https://app.test/api/v1/admin/events/sync-from-hugo", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(syncPayload),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createAdminToken(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return createAdminSession(env.DB, admin.id, "event-sync-admin-token");
}

describe("admin Hugo event synchronization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires events:write for an authenticated staff user", async () => {
    await seedEventAndAdmin(env.DB);
    const staffId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'event-sync-denied@example.test', 'event-sync-denied@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(staffId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-membership_processor', NULL, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffId),
    ]);
    const token = await createAdminSession(env.DB, staffId, "event-sync-denied-token");

    const response = await callSync(token);

    expect(response.status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = ?", syncPayload.event.slug)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_synced_from_hugo'")).toHaveLength(0);
  });

  it("atomically persists the event, both term audiences, and audit record", async () => {
    const token = await createAdminToken();

    const response = await callSync(token);

    expect(response.status).toBe(200);
    const [event] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM events WHERE slug = ?",
      syncPayload.event.slug,
    );
    const terms = await queryAll<{ audience_type: string; term_key: string }>(
      env.DB,
      "SELECT audience_type, term_key FROM event_terms WHERE event_id = ? AND active = 1 ORDER BY audience_type",
      event.id,
    );
    expect(terms).toEqual([
      { audience_type: "attendee", term_key: "privacy-policy" },
      { audience_type: "speaker", term_key: "speaker-terms" },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'event_synced_from_hugo' AND entity_id = ?",
        event.id,
      ),
    ).toHaveLength(1);
  });

  it("rolls back the event and terms when the audit insert fails", async () => {
    const token = await createAdminToken();
    await env.DB.prepare(
      `CREATE TRIGGER fail_event_sync_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'event_synced_from_hugo'
       BEGIN
         SELECT RAISE(ABORT, 'forced event sync audit failure');
       END`,
    ).run();

    const response = await callSync(token);

    expect(response.status).toBe(500);
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = ?", syncPayload.event.slug)).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM event_terms WHERE term_key IN ('privacy-policy', 'speaker-terms') AND version = 'v2'",
      ),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_synced_from_hugo'")).toHaveLength(0);
  });
});
