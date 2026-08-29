import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { guardPermissionDatabase } from "../functions/_lib/auth/permissions";
import { AppError } from "../functions/_lib/errors";
import { importEvent } from "../functions/_lib/services/events";

const importPayload = {
  source: "hugo",
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

async function callImport(token: string): Promise<Response> {
  return app.fetch(
    new Request("https://app.test/api/v1/events/imports", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(importPayload),
    }),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createAdminToken(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  return createAdminSession(env.DB, admin.id, "event-import-admin-token");
}

describe("event imports", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires events:write for an authenticated staff user", async () => {
    await seedEventAndAdmin(env.DB);
    const staffId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'event-import-denied@example.test', 'event-import-denied@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(staffId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-membership_processor', NULL, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffId),
    ]);
    const token = await createAdminSession(env.DB, staffId, "event-import-denied-token");

    const response = await callImport(token);

    expect(response.status).toBe(403);
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = ?", importPayload.event.slug)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_imported'")).toHaveLength(0);
  });

  it("atomically persists the event, both term audiences, and audit record", async () => {
    const token = await createAdminToken();

    const response = await callImport(token);

    expect(response.status).toBe(200);
    const [event] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM events WHERE slug = ?",
      importPayload.event.slug,
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
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_imported' AND entity_id = ?", event.id),
    ).toHaveLength(1);
  });

  it("rolls back the event and terms when the audit insert fails", async () => {
    const token = await createAdminToken();
    await env.DB.prepare(
      `CREATE TRIGGER fail_event_import_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'event_imported'
       BEGIN
         SELECT RAISE(ABORT, 'forced event import audit failure');
       END`,
    ).run();

    const response = await callImport(token);

    expect(response.status).toBe(500);
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = ?", importPayload.event.slug)).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM event_terms WHERE term_key IN ('privacy-policy', 'speaker-terms') AND version = 'v2'",
      ),
    ).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_imported'")).toHaveLength(0);
  });

  it("rejects the shared API key because imports require an attributable user", async () => {
    await seedEventAndAdmin(env.DB);
    const response = await app.fetch(
      new Request("https://app.test/api/v1/events/imports", {
        method: "POST",
        headers: { authorization: `Bearer ${env.ADMIN_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(importPayload),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = ?", importPayload.event.slug)).toHaveLength(0);
  });

  it("fails closed when events:write is revoked between authorization and the write batch", async () => {
    await seedEventAndAdmin(env.DB);
    const staffId = crypto.randomUUID();
    const roleAssignmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'event-import-raced@example.test', 'event-import-raced@example.test', 'user', 1,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ).bind(staffId),
      env.DB.prepare(
        `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
           VALUES (?, ?, 'role-event_organizer', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ).bind(roleAssignmentId, staffId),
    ]);
    const actor = createUserBackedAuthAdmin({
      id: staffId,
      email: "event-import-raced@example.test",
      role: "user",
      scopes: [],
      grants: [{ permission: "events:write", contextType: null, contextId: null }],
    });

    // Revoke the grant after the service has decided what to write but before
    // its batch commits. The in-batch guard must abort the whole import.
    const racedDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE user_roles SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(roleAssignmentId)
        .run();
    });
    const guardedDb = guardPermissionDatabase(
      racedDb,
      actor,
      [{ permission: "events:write" }],
      () =>
        new AppError(409, "EVENT_IMPORT_AUTHORIZATION_CHANGED", "Event write permission changed during this import"),
    );

    await expect(
      importEvent(
        guardedDb,
        "hugo",
        { slug: "raced-import", name: "Raced Import", timezone: "UTC" },
        undefined,
        staffId,
      ),
    ).rejects.toMatchObject({ code: "EVENT_IMPORT_AUTHORIZATION_CHANGED" });

    expect(await queryAll(env.DB, "SELECT id FROM events WHERE slug = 'raced-import'")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'event_imported'")).toHaveLength(0);
  });
});
