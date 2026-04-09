import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env as workerEnv } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { queueEmail, processPendingOutbox, processSelectedOutbox } from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
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

async function seedTemplate(db: typeof env.DB, adminId: string, templateKey: string, content: string, subjectTemplate: string): Promise<void> {
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

  it("respects the limit parameter and only processes up to limit rows", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);

    await queueN(env.DB, eventId, 5);
    const result = await processPendingOutbox(env.DB, env, 2);

    expect(result.processed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sentRows = await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE status = 'sent'");
    expect(sentRows).toHaveLength(2);

    const queuedRows = await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE status = 'queued'");
    expect(queuedRows).toHaveLength(3);
  });

  it("processes emails in chunks — a single SendGrid failure does not block other emails", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount += 1;
      // Fail the 2nd call only
      if (callCount === 2) {
        return Promise.resolve(new Response('{"errors":[{"message":"fail"}]}', { status: 400 }));
      }
      return Promise.resolve(
        new Response(null, { status: 202, headers: { "x-message-id": `msg-${callCount}` } }),
      );
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
