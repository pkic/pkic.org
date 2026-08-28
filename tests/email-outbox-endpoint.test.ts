import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { queueEmail } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { emailOutboxQuerySchema, emailOutboxResponseSchema } from "../assets/shared/schemas/email-outbox";
import { buildEmailOutboxQueryStatements } from "../functions/_lib/services/email-outbox/query";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";

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

describe("GET /api/v1/email/outbox", () => {
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
    const statusRes = await callAdmin("/api/v1/email/outbox?status=failed");
    expect(statusRes.status).toBe(200);
    const statusPayload = emailOutboxResponseSchema.parse(await statusRes.json());
    expect(statusPayload.outbox.map((r) => r.id)).toEqual([failedId]);

    // messageType filter
    const typeRes = await callAdmin("/api/v1/email/outbox?messageType=promotional");
    expect(typeRes.status).toBe(200);
    const typePayload = emailOutboxResponseSchema.parse(await typeRes.json());
    expect(typePayload.outbox.map((r) => r.id)).toEqual([promoId]);

    // dueNow filter — queued rows with send_after <= now are due; failed rows are not
    const dueRes = await callAdmin("/api/v1/email/outbox?dueNow=true");
    expect(dueRes.status).toBe(200);
    const duePayload = emailOutboxResponseSchema.parse(await dueRes.json());
    const dueIds = duePayload.outbox.map((r) => r.id).sort();
    expect(dueIds).toEqual([promoId, queuedId].sort());

    // q filter — matches recipient email
    const qRes = await callAdmin("/api/v1/email/outbox?q=alice");
    expect(qRes.status).toBe(200);
    const qPayload = emailOutboxResponseSchema.parse(await qRes.json());
    expect(qPayload.outbox.map((r) => r.id)).toEqual([queuedId]);

    const sortedRes = await callAdmin("/api/v1/email/outbox?sort=-recipient");
    expect(sortedRes.status).toBe(200);
    const sortedPayload = emailOutboxResponseSchema.parse(await sortedRes.json());
    expect(sortedPayload.outbox.map((row) => row.recipientEmail)).toEqual([
      "carol@example.test",
      "bob@example.test",
      "alice@example.test",
    ]);

    // A filtered second page must retain the filtered total, rather than the
    // unfiltered table total.
    const pageRes = await callAdmin("/api/v1/email/outbox?messageType=transactional&sort=recipient&limit=1&offset=1");
    expect(pageRes.status).toBe(200);
    const pagePayload = emailOutboxResponseSchema.parse(await pageRes.json());
    expect(pagePayload.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect(pagePayload.outbox.map((row) => row.id)).toEqual([failedId]);
  });

  it("rejects a limit above the schema max instead of silently clamping it", async () => {
    await setupAdmin();

    const response = await callAdmin("/api/v1/email/outbox?limit=500");
    expect(response.status).toBe(400);
    expect((await callAdmin("/api/v1/email/outbox?sort=provider_message_id")).status).toBe(400);
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

    const response = await callAdmin("/api/v1/email/outbox?q=pinned&limit=10");
    expect(response.status).toBe(200);
    const payload = emailOutboxResponseSchema.parse(await response.json());

    expect(payload.outbox).toHaveLength(5);
    const byId = new Map(payload.outbox.map((row) => [row.id, row]));

    expect(byId.get(rowIds[0])?.subject).toBe("Version two subject");
    expect(byId.get(rowIds[1])?.subject).toBe("Version two subject");
    expect(byId.get(rowIds[2])?.subject).toBe("Version three subject");
    expect(byId.get(rowIds[3])?.subject).toBe("Version three subject");
    expect(byId.get(rowIds[4])?.templateVersion).toBeNull();
    expect(byId.get(rowIds[4])?.subject).toBe("Version one subject");
  });

  it("keeps the exact due-now page, count, and status aggregate on the partial due index", async () => {
    await setupAdmin();
    const query = emailOutboxQuerySchema.parse({ dueNow: true, limit: 25, offset: 0, sort: "sendAfter" });
    const statements = buildEmailOutboxQueryStatements(query, "2026-08-28T00:00:00.000Z");
    const page = buildOffsetPageSql(statements.page);

    const pagePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${page.pageSql}`)
      .bind(...page.bindings, query.limit, query.offset)
      .all<{ detail: string }>();
    const countPlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${page.countSql}`)
      .bind(...page.countBindings)
      .all<{ detail: string }>();
    const statusPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT o.status, COUNT(*) AS count
       ${statements.aggregateFrom} ${statements.where}
       GROUP BY o.status`,
    )
      .bind(...statements.bindings)
      .all<{ detail: string }>();

    for (const plan of [pagePlan, countPlan, statusPlan]) {
      expect(
        plan.results.some((row) => row.detail.includes("idx_email_outbox_due")),
        JSON.stringify(plan.results),
      ).toBe(true);
    }
  });
});
