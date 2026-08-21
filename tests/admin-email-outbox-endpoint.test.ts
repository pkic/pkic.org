import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { queueEmail } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { adminEmailOutboxResponseSchema } from "../assets/shared/schemas/admin-email-outbox";

let ADMIN_TOKEN = "email-outbox-admin-token";

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdmin(): Promise<{ eventId: string; adminId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { eventId, adminId: adminRow.id };
}

describe("GET /api/v1/admin/email/outbox", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("filters by status, messageType, dueNow, and q via the validated query schema", async () => {
    const { eventId, adminId } = await setupAdmin();
    await createTemplateVersion(env.DB, {
      templateKey: "outbox_test_template",
      content: "hello {{firstName}}",
      subjectTemplate: "Active subject",
      createdByUserId: adminId,
    });
    await activateTemplateVersion(env.DB, { templateKey: "outbox_test_template", version: 1 });

    const queuedId = await queueEmail(env.DB, {
      eventId,
      templateKey: "outbox_test_template",
      recipientEmail: "alice@example.test",
      messageType: "transactional",
      data: { firstName: "Alice" },
    });
    const promoId = await queueEmail(env.DB, {
      eventId,
      templateKey: "outbox_test_template",
      recipientEmail: "bob@example.test",
      messageType: "promotional",
      data: { firstName: "Bob" },
    });
    const failedId = await queueEmail(env.DB, {
      eventId,
      templateKey: "outbox_test_template",
      recipientEmail: "carol@example.test",
      messageType: "transactional",
      data: { firstName: "Carol" },
    });
    await env.DB.prepare("UPDATE email_outbox SET status = 'failed', last_error = 'boom' WHERE id = ?")
      .bind(failedId)
      .run();

    // status filter
    const statusRes = await callAdmin("/api/v1/admin/email/outbox?status=failed");
    expect(statusRes.status).toBe(200);
    const statusPayload = adminEmailOutboxResponseSchema.parse(await statusRes.json());
    expect(statusPayload.outbox.map((r) => r.id)).toEqual([failedId]);

    // messageType filter
    const typeRes = await callAdmin("/api/v1/admin/email/outbox?messageType=promotional");
    expect(typeRes.status).toBe(200);
    const typePayload = adminEmailOutboxResponseSchema.parse(await typeRes.json());
    expect(typePayload.outbox.map((r) => r.id)).toEqual([promoId]);

    // dueNow filter — queued rows with send_after <= now are due; failed rows are not
    const dueRes = await callAdmin("/api/v1/admin/email/outbox?dueNow=true");
    expect(dueRes.status).toBe(200);
    const duePayload = adminEmailOutboxResponseSchema.parse(await dueRes.json());
    const dueIds = duePayload.outbox.map((r) => r.id).sort();
    expect(dueIds).toEqual([promoId, queuedId].sort());

    // q filter — matches recipient email
    const qRes = await callAdmin("/api/v1/admin/email/outbox?q=alice");
    expect(qRes.status).toBe(200);
    const qPayload = adminEmailOutboxResponseSchema.parse(await qRes.json());
    expect(qPayload.outbox.map((r) => r.id)).toEqual([queuedId]);

    const sortedRes = await callAdmin("/api/v1/admin/email/outbox?sort=-recipient");
    expect(sortedRes.status).toBe(200);
    const sortedPayload = adminEmailOutboxResponseSchema.parse(await sortedRes.json());
    expect(sortedPayload.outbox.map((row) => row.recipientEmail)).toEqual([
      "carol@example.test",
      "bob@example.test",
      "alice@example.test",
    ]);

    // limit/offset — total reflects all 3 rows regardless of page size
    const pageRes = await callAdmin("/api/v1/admin/email/outbox?limit=1&offset=0");
    expect(pageRes.status).toBe(200);
    const pagePayload = adminEmailOutboxResponseSchema.parse(await pageRes.json());
    expect(pagePayload.page).toEqual({ limit: 1, offset: 0, total: 3, hasMore: true });
    expect(pagePayload.outbox).toHaveLength(1);
  });

  it("rejects a limit above the schema max instead of silently clamping it", async () => {
    await setupAdmin();

    const response = await callAdmin("/api/v1/admin/email/outbox?limit=500");
    expect(response.status).toBe(400);
    expect((await callAdmin("/api/v1/admin/email/outbox?sort=provider_message_id")).status).toBe(400);
  });

  it("resolves per-row subjects for distinct pinned template versions via the batched preload", async () => {
    const { eventId, adminId } = await setupAdmin();

    await createTemplateVersion(env.DB, {
      templateKey: "pinned_template",
      content: "v1 body",
      subjectTemplate: "Version one subject",
      createdByUserId: adminId,
    });
    await activateTemplateVersion(env.DB, { templateKey: "pinned_template", version: 1 });
    // Draft v2/v3 — never activated, so each is only reachable by explicit template_version pin,
    // exercising the batched (template_key, version) preload rather than the active-template cache.
    await createTemplateVersion(env.DB, {
      templateKey: "pinned_template",
      content: "v2 body",
      subjectTemplate: "Version two subject",
      createdByUserId: adminId,
    });
    await createTemplateVersion(env.DB, {
      templateKey: "pinned_template",
      content: "v3 body",
      subjectTemplate: "Version three subject",
      createdByUserId: adminId,
    });

    const rowIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await queueEmail(env.DB, {
        eventId,
        templateKey: "pinned_template",
        recipientEmail: `pinned${i}@example.test`,
        messageType: "transactional",
        data: {},
      });
      rowIds.push(id);
    }
    // Two rows pinned to v2, two rows pinned to v3, one left unpinned (resolves the active v1).
    await env.DB.batch([
      env.DB.prepare("UPDATE email_outbox SET template_version = 2 WHERE id = ?").bind(rowIds[0]),
      env.DB.prepare("UPDATE email_outbox SET template_version = 2 WHERE id = ?").bind(rowIds[1]),
      env.DB.prepare("UPDATE email_outbox SET template_version = 3 WHERE id = ?").bind(rowIds[2]),
      env.DB.prepare("UPDATE email_outbox SET template_version = 3 WHERE id = ?").bind(rowIds[3]),
    ]);

    const response = await callAdmin("/api/v1/admin/email/outbox?q=pinned&limit=10");
    expect(response.status).toBe(200);
    const payload = adminEmailOutboxResponseSchema.parse(await response.json());

    expect(payload.outbox).toHaveLength(5);
    const byId = new Map(payload.outbox.map((row) => [row.id, row]));

    expect(byId.get(rowIds[0])?.subject).toBe("Version two subject");
    expect(byId.get(rowIds[1])?.subject).toBe("Version two subject");
    expect(byId.get(rowIds[2])?.subject).toBe("Version three subject");
    expect(byId.get(rowIds[3])?.subject).toBe("Version three subject");
    expect(byId.get(rowIds[4])?.templateVersion).toBeNull();
    expect(byId.get(rowIds[4])?.subject).toBe("Version one subject");
  });
});
