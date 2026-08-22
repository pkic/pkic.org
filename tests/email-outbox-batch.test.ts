import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env as workerEnv } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import {
  bulkQueueInviteEmails,
  prepareBulkQueueEmailChunkStatements,
  prepareQueueEmailStatement,
  queueEmail,
  processPendingOutbox,
  processSelectedOutbox,
  resetFailedOutbox,
} from "../functions/_lib/email/outbox";
import {
  createTemplateVersion,
  activateTemplateVersion,
  invalidateTemplateCache,
} from "../functions/_lib/email/templates";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import type { Env } from "../functions/_lib/types";

const env = workerEnv as unknown as Env;

function makeSendgridMock(statusCode = 202, messageIdSuffix = ""): ReturnType<typeof vi.fn> {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount += 1;
    return Promise.resolve(
      new Response(null, {
        status: statusCode,
        headers: { "x-message-id": `msg-${callCount}${messageIdSuffix}` },
      }),
    );
  });
}

async function seedTemplate(
  db: typeof env.DB,
  adminId: string,
  templateKey: string,
  content: string,
  subjectTemplate: string,
): Promise<void> {
  const t = await createTemplateVersion(db, { templateKey, content, createdByUserId: adminId, subjectTemplate });
  await activateTemplateVersion(db, { templateKey, version: t.version });
}

async function seedRequiredTemplates(db: typeof env.DB, adminId: string): Promise<void> {
  await seedTemplate(db, adminId, "email_layout", "{{{body_html}}}", "Email layout");
  await seedTemplate(db, adminId, "partial_reg_details", "Registration details", "Partial: registration details");
  await seedTemplate(db, adminId, "partial_sponsors_block", "Sponsors block", "Partial: sponsors block");
  await seedTemplate(db, adminId, "partial_about_pkic", "About PKIC", "Partial: about PKIC");
  await seedTemplate(db, adminId, "partial_donation_request", "Donation request", "Partial: donation request");
  await seedTemplate(db, adminId, "attendee_invite", "Hello {{firstName}}", "You are invited");
}

async function queueN(db: typeof env.DB, eventId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await queueEmail(db, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: `user${i}@example.test`,
      messageType: "transactional",
      data: { firstName: `User${i}` },
    });
    ids.push(id);
  }
  return ids;
}

describe("email outbox batch processing", () => {
  let eventId: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    const seed = await seedEventAndAdmin(env.DB);
    eventId = seed.eventId;
    const adminRows = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    adminId = adminRows[0].id;
    await seedRequiredTemplates(env.DB, adminId);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("processes all queued emails and marks them sent", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    await queueN(env.DB, eventId, 3);
    const result = await processPendingOutbox(env.DB, env, 10);

    expect(result.processed).toBe(3);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const rows = await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox");
    expect(rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("enqueues a domain notification exactly once when concurrent batches reuse its idempotency key", async () => {
    const payload = {
      outboxId: "1234567890abcdef1234567890abcdef",
      idempotencyKey: "speaker_invite:proposal-1:speaker-1:0",
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "same@example.test",
      messageType: "transactional" as const,
      data: { firstName: "Same" },
    };
    const first = prepareQueueEmailStatement(env.DB, payload);
    const duplicate = prepareQueueEmailStatement(env.DB, payload);
    await Promise.all([env.DB.batch([first.statement]), env.DB.batch([duplicate.statement])]);

    const rows = await queryAll<{ id: string; idempotency_key: string }>(
      env.DB,
      "SELECT id, idempotency_key FROM email_outbox WHERE idempotency_key = ?",
      [payload.idempotencyKey],
    );
    expect(rows).toEqual([{ id: payload.outboxId, idempotency_key: payload.idempotencyKey }]);
  });

  it("claims an idempotent outbox row once when direct processors race or retry", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      outboxId: "abcdef1234567890abcdef1234567890",
      idempotencyKey: "donation_thank_you:donation-1",
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "same@example.test",
      messageType: "transactional" as const,
      data: { firstName: "Same" },
    };
    const outboxId = await queueEmail(env.DB, payload);

    const [first, second] = await Promise.all([
      processSelectedOutbox(env.DB, env, [outboxId]),
      processSelectedOutbox(env.DB, env, [outboxId]),
    ]);
    const retry = await processSelectedOutbox(env.DB, env, [outboxId]);

    expect(first.processed + second.processed).toBe(1);
    expect(first.skipped + second.skipped).toBe(1);
    expect(retry).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [outboxId]),
    ).toEqual([{ status: "sent" }]);
  });

  it("quarantines an expired sending lease without replaying it and leaves a live lease untouched", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const [expiredId, liveId] = await queueN(env.DB, eventId, 2);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_outbox
              SET status = 'sending', processing_token = 'abandoned',
                  lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
            WHERE id = ?`,
      ).bind(expiredId),
      env.DB.prepare(
        `UPDATE email_outbox
              SET status = 'sending', processing_token = 'current',
                  lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes')
            WHERE id = ?`,
      ).bind(liveId),
    ]);

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await queryAll<{ id: string; status: string; processing_token: string | null }>(
        env.DB,
        "SELECT id, status, processing_token FROM email_outbox WHERE id IN (?, ?) ORDER BY id",
        [expiredId, liveId],
      ),
    ).toEqual(
      [
        { id: expiredId, status: "delivery_unknown", processing_token: null },
        { id: liveId, status: "sending", processing_token: "current" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("does not automatically replay a transport-ambiguous SendGrid request", async () => {
    let sentPayload: unknown;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentPayload = JSON.parse(String(init.body));
      return Promise.reject(new Error("connection closed after request write"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const [outboxId] = await queueN(env.DB, eventId, 1);

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const sentCustomArgs = (
      sentPayload as { personalizations: Array<{ custom_args: { outbox_id: string; env_url?: string } }> }
    ).personalizations[0]?.custom_args;
    expect(sentCustomArgs?.outbox_id).toBe(outboxId);
    expect(
      await queryAll<{ status: string; last_error: string }>(
        env.DB,
        "SELECT status, last_error FROM email_outbox WHERE id = ?",
        [outboxId],
      ),
    ).toEqual([
      {
        status: "delivery_unknown",
        last_error: expect.stringContaining("SENDGRID_DELIVERY_UNKNOWN"),
      },
    ]);

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("persists an accepted request as delivery unknown when finalizing sent state fails", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const [outboxId] = await queueN(env.DB, eventId, 1);
    await env.DB.prepare(
      `CREATE TRIGGER reject_sent_finalization
       BEFORE UPDATE OF status ON email_outbox
       WHEN NEW.status = 'sent'
       BEGIN
         SELECT RAISE(ABORT, 'simulated sent finalization failure');
       END`,
    ).run();

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      await queryAll<{ status: string; provider_message_id: string | null }>(
        env.DB,
        "SELECT status, provider_message_id FROM email_outbox WHERE id = ?",
        [outboxId],
      ),
    ).toEqual([{ status: "delivery_unknown", provider_message_id: "msg-1" }]);

    await env.DB.prepare("DROP TRIGGER reject_sent_finalization").run();
  });

  it("requires an explicit reset before retrying a delivery-unknown row", async () => {
    const [outboxId] = await queueN(env.DB, eventId, 1);
    await env.DB.prepare("UPDATE email_outbox SET status = 'delivery_unknown' WHERE id = ?").bind(outboxId).run();

    expect(await resetFailedOutbox(env.DB, [outboxId])).toEqual({ reset: 1 });
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE id = ?", [outboxId]),
    ).toEqual([{ status: "retrying" }]);
  });

  it("bulk-enqueues hundreds of emails without consuming one D1 query per recipient", async () => {
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 2);
    const rows = Array.from({ length: 501 }, (_, index) => ({
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: `bulk-${index}@example.test`,
      subject: "Bulk invite",
      data: { firstName: `Bulk ${index}` },
    }));

    await bulkQueueInviteEmails(budgeted.db, rows);

    expect(budgeted.budget.usedQueries()).toBe(2);
    expect((await queryAll<{ count: number }>(env.DB, "SELECT COUNT(*) AS count FROM email_outbox"))[0]?.count).toBe(
      rows.length,
    );
  });

  it("bulk-enqueues a retried domain notification only once", async () => {
    const payload = {
      outboxId: "bulk-idempotent-outbox",
      idempotencyKey: "weekly-digest:group-1:user-1:2026-08-17",
      templateKey: "attendee_invite",
      recipientUserId: adminId,
      recipientEmail: "digest@example.test",
      subject: "Weekly digest",
      messageType: "transactional" as const,
      data: { firstName: "Digest" },
    };
    const first = prepareBulkQueueEmailChunkStatements(env.DB, [payload]);
    const retry = prepareBulkQueueEmailChunkStatements(env.DB, [payload]);

    await env.DB.batch([...first, ...retry].map((chunk) => chunk.statement));

    expect(
      await queryAll<{ id: string; idempotency_key: string }>(
        env.DB,
        "SELECT id, idempotency_key FROM email_outbox WHERE idempotency_key = ?",
        [payload.idempotencyKey],
      ),
    ).toEqual([{ id: payload.outboxId, idempotency_key: payload.idempotencyKey }]);
  });

  it("respects the limit parameter and only processes up to limit rows", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    await queueN(env.DB, eventId, 5);
    const result = await processPendingOutbox(env.DB, env, 2);

    expect(result.processed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sentRows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM email_outbox WHERE status = 'sent'",
    );
    expect(sentRows).toHaveLength(2);

    const queuedRows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM email_outbox WHERE status = 'queued'",
    );
    expect(queuedRows).toHaveLength(3);
  });

  it("processes emails in chunks — a single SendGrid failure does not block other emails", async () => {
    let callCount = 0;
    const providerBodySentinel = "SECRET_PROVIDER_BODY alice@example.test";
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      // Fail the 2nd call only
      if (callCount === 2) {
        return Promise.resolve(new Response(providerBodySentinel, { status: 400 }));
      }
      return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": `msg-${callCount}` } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueN(env.DB, eventId, 3);
    const result = await processPendingOutbox(env.DB, env, 10);

    expect(result.processed).toBe(3);
    expect(result.failed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const sent = await queryAll<{ id: string }>(env.DB, "SELECT id FROM email_outbox WHERE status = 'sent'");
    expect(sent).toHaveLength(2);

    const retrying = await queryAll<{ id: string }>(env.DB, "SELECT id FROM email_outbox WHERE status = 'retrying'");
    expect(retrying).toHaveLength(1);
    const failedDetails = await queryAll<{ last_error: string }>(
      env.DB,
      "SELECT last_error FROM email_outbox WHERE status = 'retrying'",
    );
    expect(failedDetails[0]?.last_error).toContain("SENDGRID_SEND_FAILED");
    expect(failedDetails[0]?.last_error).toContain('"kind":"provider_failure"');
    expect(failedDetails[0]?.last_error).toContain('"provider":"sendgrid"');
    expect(failedDetails[0]?.last_error).toContain('"operation":"send_email"');
    expect(failedDetails[0]?.last_error).toContain('"status":400');
    expect(failedDetails[0]?.last_error).not.toContain(providerBodySentinel);
  });

  it("processes emails concurrently within each chunk of 10", async () => {
    const startTimes: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      startTimes.push(Date.now());
      return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": "msg-x" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    // Queue exactly one chunk's worth
    await queueN(env.DB, eventId, 10);
    await processPendingOutbox(env.DB, env, 10);

    expect(fetchMock).toHaveBeenCalledTimes(10);

    // All 10 fetches should start within a short window (< 200 ms) since they run concurrently
    const spread = Math.max(...startTimes) - Math.min(...startTimes);
    expect(spread).toBeLessThan(200);
  });

  it("loads shared layout, partials, and a common template once per batch", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    await queueN(env.DB, eventId, 10);
    invalidateTemplateCache();
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 100);

    const result = await processPendingOutbox(budgeted.db, env, 10);

    expect(result).toEqual({ processed: 10, failed: 0 });
    // 1 backlog query + 5 shared render resources + 1 message template
    // + two state updates per email. This must grow by two statements per
    // row, not by reloading six templates for every concurrent recipient.
    expect(budgeted.budget.usedQueries()).toBeLessThanOrEqual(28);
  });

  it("processSelectedOutbox only processes the specified ids", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    const ids = await queueN(env.DB, eventId, 4);
    const selected = [ids[0], ids[2]];

    const result = await processSelectedOutbox(env.DB, env, selected);

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sent = await queryAll<{ id: string }>(env.DB, "SELECT id FROM email_outbox WHERE status = 'sent'");
    expect(sent.map((r) => r.id).sort()).toEqual(selected.sort());
  });

  it("processSelectedOutbox counts skipped rows for unknown ids", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    const ids = await queueN(env.DB, eventId, 1);
    const result = await processSelectedOutbox(env.DB, env, [ids[0], "non-existent-id"]);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("sends each email to the correct recipient with personalized content", async () => {
    const calls: Array<{ to: string; subject: string; bodyText: string }> = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as {
        personalizations: Array<{ to: Array<{ email: string }> }>;
        subject: string;
        content: Array<{ type: string; value: string }>;
      };
      calls.push({
        to: payload.personalizations[0].to[0].email,
        subject: payload.subject,
        bodyText: (payload.content.find((c) => c.type === "text/plain") ?? { value: "" }).value,
      });
      return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": "msg-x" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await queueN(env.DB, eventId, 3);
    await processPendingOutbox(env.DB, env, 10);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Sort by recipient so order doesn't depend on concurrency
    const sorted = calls.sort((a, b) => a.to.localeCompare(b.to));

    expect(sorted[0].to).toBe("user0@example.test");
    expect(sorted[0].subject).toBe("You are invited");
    expect(sorted[0].bodyText).toContain("User0");

    expect(sorted[1].to).toBe("user1@example.test");
    expect(sorted[1].bodyText).toContain("User1");

    expect(sorted[2].to).toBe("user2@example.test");
    expect(sorted[2].bodyText).toContain("User2");

    // Verify no two emails share the same recipient
    const recipients = sorted.map((c) => c.to);
    expect(new Set(recipients).size).toBe(3);
  });

  it("returns zero counts when outbox is empty", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    const result = await processPendingOutbox(env.DB, env, 20);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
