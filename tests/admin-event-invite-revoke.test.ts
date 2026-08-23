import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { adminEventInviteRevokeRouteSchema } from "../assets/shared/schemas/route-contracts";
import { successResponseSchema } from "../assets/shared/schemas/api-common";
import { revokeInviteByAdmin } from "../functions/_lib/services/invites";
import { getEventBySlug } from "../functions/_lib/services/events";
import { gateNextBatch } from "./helpers/d1-batch-gate";

function request(path: string, token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`https://app.test${path}`, { method: "POST", headers });
}

async function call(path: string, token?: string): Promise<Response> {
  return app.fetch(request(path, token), env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

async function insertInvite(eventId: string, status = "sent"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invites
       (id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at)
     VALUES (?, ?, ?, 'attendee', ?, ?, 'direct', datetime('now'))`,
  )
    .bind(id, eventId, `invite-${id}@example.test`, crypto.randomUUID(), status)
    .run();
  return id;
}

describe("POST /api/v1/admin/events/:eventSlug/invites/:inviteId/revoke", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requires admin authentication", async () => {
    const response = await call(`/api/v1/admin/events/pqc-2026/invites/${crypto.randomUUID()}/revoke`);
    expect(response.status).toBe(401);
  });

  it("revokes a pending invite, returns the canonical response, and writes an audit row", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0]
      .id;
    const adminToken = await createAdminSession(env.DB, adminId, "invite-revoke-token");
    const inviteId = await insertInvite(eventId);

    const response = await call(`/api/v1/admin/events/pqc-2026/invites/${inviteId}/revoke`, adminToken);

    expect(response.status).toBe(200);
    expect(successResponseSchema.parse(await response.json())).toEqual({ success: true });
    expect(adminEventInviteRevokeRouteSchema.responses["200"]).toBeDefined();
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", inviteId),
    ).resolves.toEqual([{ status: "revoked" }]);
    await expect(
      queryAll<{ action: string; entity_id: string }>(
        env.DB,
        "SELECT action, entity_id FROM audit_log WHERE entity_type = 'invite' AND entity_id = ?",
        inviteId,
      ),
    ).resolves.toEqual([{ action: "invite_revoked", entity_id: inviteId }]);
  });

  it("rejects an invite that is already in a terminal state", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0]
      .id;
    const adminToken = await createAdminSession(env.DB, adminId, "invite-revoke-terminal-token");
    const inviteId = await insertInvite(eventId, "accepted");

    const response = await call(`/api/v1/admin/events/pqc-2026/invites/${inviteId}/revoke`, adminToken);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INVITE_NOT_ACTIVE" } });
  });

  it("does not revoke an invite owned by another event", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0]
      .id;
    const adminToken = await createAdminSession(env.DB, adminId, "invite-revoke-scope-token");
    const otherEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events
         (id, slug, name, timezone, starts_at, ends_at, source_path, registration_mode, settings_json, created_at, updated_at)
       VALUES (?, 'other-event', 'Other Event', 'UTC', '2026-12-04T08:00:00Z', '2026-12-04T18:00:00Z',
               'content/events/other/_index.md', 'open', '{}', datetime('now'), datetime('now'))`,
    )
      .bind(otherEventId)
      .run();
    const inviteId = await insertInvite(otherEventId);

    const response = await call(`/api/v1/admin/events/pqc-2026/invites/${inviteId}/revoke`, adminToken);

    expect(response.status).toBe(404);
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", inviteId),
    ).resolves.toEqual([{ status: "sent" }]);
    await expect(
      queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ?", inviteId),
    ).resolves.toEqual([{ total: 0 }]);
    expect(eventId).not.toBe(otherEventId);
  });

  it("rolls back the revoke and audit when the invite changes concurrently", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const admin = (
      await queryAll<{ id: string; email: string }>(
        env.DB,
        "SELECT id, email FROM users WHERE email = 'admin@pkic.org'",
      )
    )[0];
    const inviteId = await insertInvite(eventId);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const gate = gateNextBatch(env.DB);
    const revocation = revokeInviteByAdmin(gate.db, {
      event,
      inviteId,
      admin: { identityType: "user", id: admin.id, email: admin.email, role: "admin" },
    });

    await gate.reached;
    await env.DB.prepare("UPDATE invites SET status = 'accepted' WHERE id = ?").bind(inviteId).run();
    gate.release();

    await expect(revocation).rejects.toMatchObject({ status: 409, code: "INVITE_CHANGED" });
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM invites WHERE id = ?", inviteId),
    ).resolves.toEqual([{ status: "accepted" }]);
    await expect(
      queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ?", inviteId),
    ).resolves.toEqual([{ total: 0 }]);
  });
});
