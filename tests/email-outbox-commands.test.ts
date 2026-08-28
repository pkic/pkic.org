import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { processPendingOutbox, queueEmail } from "../functions/_lib/email/outbox";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import { processEmailOutboxCommand, resetFailedEmailOutboxCommand } from "../functions/_lib/services/email-outbox";
import type { Env } from "../functions/_lib/types";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

const workerEnv = env as unknown as Env;

async function seedTemplate(adminId: string, key: string, content: string, subject: string): Promise<void> {
  const version = await createTemplateVersion(env.DB, {
    templateKey: key,
    content,
    subjectTemplate: subject,
    createdByUserId: adminId,
  });
  await activateTemplateVersion(env.DB, { templateKey: key, version: version.version });
}

async function seedTemplates(adminId: string): Promise<void> {
  await seedTemplate(adminId, "email_layout", "{{{body_html}}}", "Layout");
  await seedTemplate(adminId, "partial_reg_details", "Registration details", "Registration details");
  await seedTemplate(adminId, "partial_sponsors_block", "Sponsors", "Sponsors");
  await seedTemplate(adminId, "partial_about_pkic", "About", "About");
  await seedTemplate(adminId, "partial_donation_request", "Donate", "Donate");
  await seedTemplate(adminId, "attendee_invite", "Hello {{firstName}}", "Invite");
}

function sendGridAccepted() {
  let sequence = 0;
  return vi.fn(async () => {
    sequence += 1;
    return new Response(null, { status: 202, headers: { "x-message-id": `message-${sequence}` } });
  });
}

async function call(token: string, path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as any,
    { passThroughOnException() {}, waitUntil() {} } as any,
  );
}

describe("canonical email-outbox commands", () => {
  let eventId: string;
  let adminId: string;
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    adminToken = await createAdminSession(env.DB, adminId, "email-command-admin");
    await seedTemplates(adminId);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function queue(recipientEmail: string): Promise<string> {
    return queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail,
      messageType: "transactional",
      data: { firstName: recipientEmail },
    });
  }

  it("resets and processes only rows actually changed by the explicit selection", async () => {
    const selectedId = await queue("selected@example.test");
    const unrelatedId = await queue("unrelated@example.test");
    await env.DB.prepare("UPDATE email_outbox SET status = 'failed' WHERE id = ?").bind(selectedId).run();
    const fetchMock = sendGridAccepted();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(adminToken, "/api/v1/email/outbox/reset-failed", { ids: [selectedId] });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reset: 1, processed: 1, failed: 0, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await queryAll<{ id: string; status: string }>(
        env.DB,
        "SELECT id, status FROM email_outbox WHERE id IN (?, ?) ORDER BY id",
        [selectedId, unrelatedId],
      ),
    ).toEqual(
      [
        { id: selectedId, status: "sent" },
        { id: unrelatedId, status: "queued" },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("rejects empty reset selections before any D1 or provider side effect", async () => {
    const fetchMock = sendGridAccepted();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(adminToken, "/api/v1/email/outbox/reset-failed", { ids: [] });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action LIKE 'email_outbox_reset_%'")).toEqual([]);
  });

  it("rolls back command audit and delivery when live permissions are revoked before the first batch", async () => {
    const userId = crypto.randomUUID();
    const grantIds = [crypto.randomUUID(), crypto.randomUUID()];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'email-operator@example.test', 'email-operator@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'email:read', ?, datetime('now'))`,
      ).bind(grantIds[0], userId, adminId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'email:manage', ?, datetime('now'))`,
      ).bind(grantIds[1], userId, adminId),
    ]);
    await queue("revoked@example.test");
    const actor = createUserBackedAuthAdmin({
      id: userId,
      email: "email-operator@example.test",
      role: "user",
      grants: [
        { permission: "email:read", contextType: null, contextId: null },
        { permission: "email:manage", contextType: null, contextId: null },
      ],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?").bind(grantIds[1]).run(),
    );
    const fetchMock = sendGridAccepted();
    vi.stubGlobal("fetch", fetchMock);

    await expect(processEmailOutboxCommand(racedDb, workerEnv, actor, { limit: 1 })).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_OUTBOX_AUTHORIZATION_CHANGED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE actor_id = ?", [userId])).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT status FROM email_outbox WHERE recipient_email = 'revoked@example.test'"),
    ).toEqual([{ status: "queued" }]);
  });

  it("rolls back reset and delivery when live permissions are revoked before the first batch", async () => {
    const userId = crypto.randomUUID();
    const grantIds = [crypto.randomUUID(), crypto.randomUUID()];
    const failedId = await queue("reset-revoked@example.test");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, 'reset-operator@example.test', 'reset-operator@example.test', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'email:read', ?, datetime('now'))`,
      ).bind(grantIds[0], userId, adminId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, 'email:manage', ?, datetime('now'))`,
      ).bind(grantIds[1], userId, adminId),
      env.DB.prepare("UPDATE email_outbox SET status = 'failed' WHERE id = ?").bind(failedId),
    ]);
    const actor = createUserBackedAuthAdmin({
      id: userId,
      email: "reset-operator@example.test",
      role: "user",
      grants: [
        { permission: "email:read", contextType: null, contextId: null },
        { permission: "email:manage", contextType: null, contextId: null },
      ],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?").bind(grantIds[1]).run(),
    );
    const fetchMock = sendGridAccepted();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resetFailedEmailOutboxCommand(racedDb, workerEnv, actor, [failedId])).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_OUTBOX_AUTHORIZATION_CHANGED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE actor_id = ?", [userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [failedId])).toEqual([
      { status: "failed" },
    ]);
  });

  it("delivers one row at most once when cron and a manual command race", async () => {
    await queue("race@example.test");
    const actor = createUserBackedAuthAdmin({ id: adminId, email: "admin@pkic.org", role: "admin" });
    const fetchMock = sendGridAccepted();
    vi.stubGlobal("fetch", fetchMock);

    const [cron, manual] = await Promise.all([
      processPendingOutbox(env.DB, workerEnv, 1),
      processEmailOutboxCommand(env.DB, workerEnv, actor, { limit: 1 }),
    ]);

    expect(cron.processed + manual.processed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await queryAll(env.DB, "SELECT status FROM email_outbox WHERE recipient_email = 'race@example.test'"),
    ).toEqual([{ status: "sent" }]);
  });
});
