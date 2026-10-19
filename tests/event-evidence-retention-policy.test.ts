import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantAdministrator } from "./helpers/administrator";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import {
  readEventEvidenceRetentionPolicy,
  updateEventEvidenceRetentionPolicy,
} from "../functions/_lib/services/event-participation/retention-policy";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  eventEvidenceRetentionPolicyResponseSchema,
  eventEvidenceRetentionPolicyUpdateSchema,
} from "../assets/shared/schemas/event-evidence-retention";
beforeEach(resetDb);
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const actorId = await insertUser(env.DB, "evidence-policy@example.test");
  await grantAdministrator(env.DB, actorId);
  const token = await createAdminSession(env.DB, actorId, crypto.randomUUID());
  const path = `/api/v1/retention/events/${eventId}/policy`;
  const send = (body?: unknown) =>
    callApi(env, path, {
      method: body ? "PUT" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { eventId, actorId, send };
}
function request(revision = 0) {
  return eventEvidenceRetentionPolicyUpdateSchema.parse({
    expectedRevision: revision,
    operationId: crypto.randomUUID(),
    evidenceUntil: "2020-01-01T00:00:00.000Z",
    purposeCode: "attendance_review",
    legalHold: false,
    holdReasonCode: null,
  });
}
describe("event raw evidence policy endpoints", () => {
  it("keeps an unset cutoff explicit and rejects unpaired purpose and unexplained hold", async () => {
    const f = await fixture();
    const response = await f.send();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(eventEvidenceRetentionPolicyResponseSchema.parse(await response.json())).toMatchObject({
      revision: 0,
      status: "unconfigured",
      policy: { evidenceUntil: null, purposeCode: null, legalHold: false },
    });
    expect((await f.send({ ...request(), purposeCode: null })).status).toBe(400);
    expect((await f.send({ ...request(), legalHold: true })).status).toBe(400);
  });
  it("atomically saves revision and audit, replays the original result, and rejects stale revision", async () => {
    const f = await fixture(),
      first = request();
    const saved = await f.send(first);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const snapshot = await saved.json();
    expect((await f.send(request(1))).status).toBe(200);
    expect(await (await f.send(first)).json()).toEqual(snapshot);
    expect((await f.send({ ...first, purposeCode: "operational_review" })).status).toBe(409);
    expect((await f.send(request())).status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action='event_evidence_retention_policy_updated'",
      ).first(),
    ).toEqual({ count: 2 });
    expect(
      await env.DB.prepare("SELECT capture_closed_at,purged_at FROM event_evidence_retention_state WHERE event_id=?")
        .bind(f.eventId)
        .first(),
    ).toBeNull();
    const current = eventEvidenceRetentionPolicyResponseSchema.parse(await (await f.send()).json());
    expect(current).toMatchObject({ revision: 2, status: "due", captureClosedAt: null, purgedAt: null });
  });
  it("requires exact event management in addition to retention authority", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), f.actorId)
      .run();
    for (const permission of ["retention:read", "retention:run"])
      await env.DB.prepare("INSERT INTO permission_grants(id,user_id,permission,created_at) VALUES(?,?,?,?)")
        .bind(crypto.randomUUID(), f.actorId, permission, new Date().toISOString())
        .run();
    expect((await f.send()).status).toBe(403);
    expect((await f.send(request())).status).toBe(403);
  });
});

it.each(["permission", "session"])(
  "rolls back policy, operation and audit when %s is revoked at commit",
  async (kind) => {
    const f = await fixture();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), f.actorId)
      .run();
    for (const permission of ["retention:read", "retention:run", "events:manage"])
      await env.DB.prepare("INSERT INTO permission_grants(id,user_id,permission,created_at) VALUES(?,?,?,?)")
        .bind(crypto.randomUUID(), f.actorId, permission, new Date().toISOString())
        .run();
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?")
      .bind(f.actorId)
      .first<{ id: string }>();
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: f.actorId,
      email: "evidence-policy@example.test",
      sessionId: session!.id,
      grants: ["retention:read", "retention:run", "events:manage"].map((permission) => ({
        permission,
        contextType: null,
        contextId: null,
        expiresAt: null,
      })),
    };
    await readEventEvidenceRetentionPolicy(env.DB, actor, f.eventId);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      kind === "permission"
        ? env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=? AND permission='events:manage'")
            .bind(new Date().toISOString(), f.actorId)
            .run()
        : env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
            .bind(new Date().toISOString(), session!.id)
            .run(),
    );
    await expect(updateEventEvidenceRetentionPolicy(racingDb, actor, f.eventId, request())).rejects.toMatchObject({
      code: "RETENTION_AUTHORIZATION_CHANGED",
    });
    for (const table of ["event_evidence_retention_policies", "event_evidence_retention_policy_operations"])
      expect(
        await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE event_id=?`).bind(f.eventId).first(),
      ).toEqual({ count: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action='event_evidence_retention_policy_updated'",
      ).first(),
    ).toEqual({ count: 0 });
  },
);
