import { SCHEDULED_JOB_DEFINITIONS } from "../functions/_lib/services/scheduled-jobs/registry";
import { processPendingPromotionRenders } from "../functions/_lib/services/event-agenda/promotion-render-jobs";
import { prepareBadgeRenderJob } from "../functions/_lib/services/badge-render-job-statements";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { ADMINISTRATOR_FIXTURE_USER_SQL } from "./helpers/administrator";
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
  processOutboxById,
  processSelectedOutbox,
  resetFailedOutbox,
} from "../functions/_lib/email/outbox";
import { createTemplateVersion, activateTemplateVersion } from "../functions/_lib/email/templates";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import type { DatabaseLike, Env, StatementLike } from "../functions/_lib/types";
import { newCapabilityLinkSecret, queuedCapabilityToken } from "../functions/_lib/services/capability-links";
import { buildBadgeAttachment } from "../functions/_lib/email/attachments";
import { validPngBytes } from "./helpers/raster-images";

const env = workerEnv as unknown as Env;

function makeSendgridMock(statusCode = 202, messageIdSuffix = "") {
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

function failingStatement(error: Error): StatementLike {
  const statement = {
    bind: () => statement,
    run: () => Promise.reject(error),
    all: () => Promise.reject(error),
    first: () => Promise.reject(error),
  } as unknown as StatementLike;
  return statement;
}

// A badge row belongs to the registration's user, so the code needs a real owner.
async function queueBadgeRender(eventId: string, email: string) {
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id,email,normalized_email,created_at,updated_at) VALUES (?,?,?,datetime('now'),datetime('now'))",
    ).bind(userId, email, email),
    env.DB.prepare(
      "INSERT INTO registrations (id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES (?,?,?,'registered','test',?,datetime('now'),datetime('now'))",
    ).bind(registrationId, eventId, userId, crypto.randomUUID()),
  ]);
  const code = await createReferralCode(env.DB, {
    eventId,
    ownerType: "registration",
    ownerId: registrationId,
    length: 10,
  });
  const job = prepareBadgeRenderJob(env.DB, code, "2000-01-01T00:00:00.000Z");
  await job.statement.run();
  return { code, job };
}

const emailDeliveryJob = () => SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;

describe("email outbox batch processing", () => {
  it("keeps unmocked email delivery on a local-only test endpoint", () => {
    expect(new URL(env.SENDGRID_API_BASE!).hostname).toBe("127.0.0.1");
  });

  let eventId: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    // resetDb keeps this reference table, so release a lease an earlier test stalled.
    await env.DB.prepare(
      "UPDATE scheduled_jobs SET running_since=NULL,lease_expires_at=NULL,run_token=NULL WHERE job_key='due_work'",
    ).run();
    const seed = await seedEventAndAdmin(env.DB);
    eventId = seed.eventId;
    const adminRows = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    adminId = adminRows[0].id;
    await seedRequiredTemplates(env.DB, adminId);
  });

  it("drains successive batches until the ready queue is empty while due work is leased", async () => {
    await env.DB.prepare(
      "UPDATE scheduled_jobs SET running_since='2026-11-09T00:00:00.000Z',lease_expires_at='2999-01-01T00:00:00.000Z',run_token='stalled' WHERE job_key='due_work'",
    ).run();
    const ids = await queueN(env.DB, eventId, 105);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const result = await job.run({ env: { ...env, DB: db }, d1QueryBudget: budget });
    expect(result).toMatchObject({ summary: { processed: 105, failed: 0, selections: 2, stoppedReason: "empty" } });
    expect(result).not.toHaveProperty("nextRunAt");
    // 210 claim/settlement statements, four selection/recovery statements,
    // and six shared template/resource reads across the entire pool.
    expect(budget.usedQueries()).toBeLessThanOrEqual(220);
    expect(send).toHaveBeenCalledTimes(105);
    const remaining = await queryAll<{ count: number }>(
      env.DB,
      "SELECT count(*) AS count FROM email_outbox WHERE status='queued' AND id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(ids)],
    );
    expect(remaining[0].count).toBe(0);
  });

  it("refills free channels across selections while one send is still pending", async () => {
    await queueN(env.DB, eventId, 25);
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const deliveredIds = new Set<string>();
    let active = 0;
    let peak = 0;
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const id = payload.personalizations[0].custom_args.outbox_id as string;
      expect(deliveredIds.has(id)).toBe(false);
      deliveredIds.add(id);
      active++;
      peak = Math.max(peak, active);
      if (deliveredIds.size === 1) await first;
      active--;
      return new Response(null, { status: 202, headers: { "x-message-id": id } });
    });
    vi.stubGlobal("fetch", send);
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const running = job.run({ env: { ...env, DB: db, SCHEDULED_OUTBOX_LIMIT: "10" }, d1QueryBudget: budget });
    try {
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(25));
      expect(active).toBe(1);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(10);
    } finally {
      releaseFirst();
      await running;
    }
    expect(await running).toMatchObject({ summary: { processed: 25, failed: 0, stoppedReason: "empty" } });
    expect(deliveredIds.size).toBe(25);
  });

  it("continues past a full batch of obsolete mail to send the ready messages behind it", async () => {
    const ids = await queueN(env.DB, eventId, 12);
    await env.DB.prepare(
      "UPDATE email_outbox SET payload_json=json_set(payload_json,'$.__deliveryGuard',json(?)) WHERE id IN (SELECT value FROM json_each(?))",
    )
      .bind(JSON.stringify({ id: "missing-notification", version: 1 }), JSON.stringify(ids.slice(0, 10)))
      .run();
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const result = await job.run({ env: { ...env, DB: db }, d1QueryBudget: budget });
    expect(result).toMatchObject({ summary: { processed: 12, selections: 1, stoppedReason: "empty" } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("yields with unclaimed mail remaining after spending its database budget", async () => {
    await queueN(env.DB, eventId, 100);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 120);
    const result = await job.run({ env: { ...env, DB: db }, d1QueryBudget: budget });
    expect(result).toMatchObject({
      summary: { stoppedReason: "d1_query_limit", failed: 0 },
      nextRunAt: expect.any(String),
    });
    expect(send.mock.calls.length).toBeGreaterThan(0);
    expect(send.mock.calls.length).toBeLessThan(100);
    expect(budget.usedQueries()).toBeLessThan(120);
    const rows = await queryAll<{ status: string }>(env.DB, "SELECT DISTINCT status FROM email_outbox");
    expect(rows).toContainEqual({ status: "queued" });
    expect(rows).not.toContainEqual({ status: "sending" });
  });

  it("leaves mail unclaimed and requests another run when its database budget is too low", async () => {
    await queueN(env.DB, eventId, 3);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 10);
    const result = await job.run({ env: { ...env, DB: db }, d1QueryBudget: budget });
    expect(result).toMatchObject({
      summary: { processed: 0, stoppedReason: "d1_query_limit" },
      nextRunAt: expect.any(String),
    });
    expect(send).not.toHaveBeenCalled();
    expect(budget.usedQueries()).toBe(0);
  });

  it("yields before another slow batch would overrun its elapsed-time reserve", async () => {
    await queueN(env.DB, eventId, 25);
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", () => {
      clock += 1_000;
      return send();
    });
    try {
      const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "email_outbox")!;
      const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
      const result = await job.run({ env: { ...env, DB: db }, d1QueryBudget: budget });
      expect(result).toMatchObject({
        summary: { processed: 10, selections: 1, stoppedReason: "time_limit" },
        nextRunAt: expect.any(String),
      });
      expect(send).toHaveBeenCalledTimes(10);
      const rows = await queryAll<{ status: string; count: number }>(
        env.DB,
        "SELECT status,count(*) AS count FROM email_outbox GROUP BY status",
      );
      expect(rows).toContainEqual({ status: "queued", count: 15 });
      expect(rows.some((row) => row.status === "sending")).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("stops and leaves mail queued when delivery claims cannot be written", async () => {
    await queueN(env.DB, eventId, 12);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const claims = vi.fn();
    const overloaded: DatabaseLike = {
      ...db,
      prepare: (sql) => {
        if (!sql.includes("SET status = 'sending'")) return db.prepare(sql);
        claims();
        return failingStatement(new Error("D1 overloaded"));
      },
    };

    await expect(emailDeliveryJob().run({ env: { ...env, DB: overloaded }, d1QueryBudget: budget })).rejects.toThrow(
      "D1 overloaded",
    );

    expect(claims.mock.calls.length).toBeLessThanOrEqual(10);
    expect(send).not.toHaveBeenCalled();
    expect(await queryAll(env.DB, "SELECT DISTINCT status FROM email_outbox")).toEqual([{ status: "queued" }]);
  });

  it("reads shared templates again after a failed read", async () => {
    await queueN(env.DB, eventId, 25);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    let readFailed = false;
    const flaky: DatabaseLike = {
      ...db,
      prepare: (sql) => {
        if (readFailed || !sql.includes("active_rank")) return db.prepare(sql);
        readFailed = true;
        return failingStatement(new Error("D1 overloaded"));
      },
    };

    const result = await emailDeliveryJob().run({ env: { ...env, DB: flaky }, d1QueryBudget: budget });

    // Only messages already waiting on the failed read may share its failure.
    const { failed } = (result as { summary: { failed: number } }).summary;
    expect(failed).toBeGreaterThan(0);
    expect(failed).toBeLessThanOrEqual(10);
    expect(send).toHaveBeenCalledTimes(25 - failed);
  });

  it("waits for its interval and leaves mail queued during email maintenance", async () => {
    await queueN(env.DB, eventId, 3);
    const send = makeSendgridMock();
    vi.stubGlobal("fetch", send);
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);

    const result = await emailDeliveryJob().run({
      env: { ...env, DB: db, SERVICE_MODE: "maintenance" },
      d1QueryBudget: budget,
    });

    expect(result).toMatchObject({ idle: true, summary: { processed: 0, stoppedReason: "email_unavailable" } });
    expect(result).not.toHaveProperty("nextRunAt");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports an idle run when no mail is due", async () => {
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const result = await emailDeliveryJob().run({ env: { ...env, DB: db }, d1QueryBudget: budget });
    expect(result).toMatchObject({ idle: true, summary: { processed: 0, stoppedReason: "empty" } });
  });

  it("renders up to the configured limit in one run and reports idle once none are due", async () => {
    await queueBadgeRender(eventId, "render-one@example.test");
    await queueBadgeRender(eventId, "render-two@example.test");
    await queueBadgeRender(eventId, "render-three@example.test");
    const job = SCHEDULED_JOB_DEFINITIONS.find((definition) => definition.key === "promotion_rendering")!;
    const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 900);
    const jobEnv = { ...env, DB: db, SCHEDULED_RENDER_LIMIT: "2" };

    const busy = await job.run({ env: jobEnv, d1QueryBudget: budget });
    const { renders } = (busy as { summary: { renders: { processed: number; failed: number } } }).summary;
    expect(renders.processed + renders.failed).toBe(2);
    expect(busy).toMatchObject({ idle: false });

    await env.DB.prepare("DELETE FROM event_promotion_renders").run();
    expect(await job.run({ env: jobEnv, d1QueryBudget: budget })).toMatchObject({ idle: true });
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

  it("retries a required social badge until its current image exists, then sends it once", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const badge = buildBadgeAttachment({ badgeCode: crypto.randomUUID(), badgeType: "attendee" });
    const bucket = env.ASSETS_BUCKET!;
    const id = await queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "badge-ready@example.test",
      messageType: "transactional",
      data: { firstName: "Example" },
      attachments: [badge],
    });
    const due = () =>
      env.DB.prepare("UPDATE email_outbox SET send_after=? WHERE id=?").bind("2000-01-01T00:00:00.000Z", id).run();
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    await bucket.put(badge.r2Key, validPngBytes(), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { badgeRenderer: "previous-renderer" },
    });
    await due();
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    await bucket.put(badge.r2Key, validPngBytes(), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { badgeRenderer: badge.renderer! },
    });
    await due();
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 0 });
    await processOutboxById(env.DB, env, id);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).attachments).toEqual([
      expect.objectContaining({ filename: "attendee-badge.png", type: "image/png", disposition: "attachment" }),
    ]);
    // The outbox keeps the names it sent, which only the stored file can give.
    const [sent] = await queryAll<{ names: string }>(
      env.DB,
      "SELECT json_extract(payload_json, '$.__sentAttachmentNames') AS names FROM email_outbox WHERE id = ?",
      [id],
    );
    expect(JSON.parse(sent.names)).toEqual(["attendee-badge.png"]);
  });

  it("recovers a completed older-renderer badge through its existing job before delivering the waiting email", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const { code, job } = await queueBadgeRender(eventId, "waiting@example.test");
    const badge = buildBadgeAttachment({ badgeCode: code, badgeType: "attendee" });
    await env.DB.prepare("UPDATE event_promotion_renders SET status='rendered',updated_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", job.id)
      .run();
    await env.ASSETS_BUCKET!.put(badge.r2Key, validPngBytes(), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { badgeRenderer: "promotion-scene-v5" },
    });
    const id = await queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "waiting@example.test",
      messageType: "transactional",
      data: { firstName: "Waiting" },
      attachments: [{ ...badge, renderer: "promotion-scene-v5" }],
    });
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    const render = vi.fn(async () => {
      await env.ASSETS_BUCKET!.put(badge.r2Key, validPngBytes(), {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { badgeRenderer: badge.renderer! },
      });
    });
    expect(await processPendingPromotionRenders(env.DB, env, 1, render)).toEqual({ processed: 1, failed: 0 });
    expect(await processPendingPromotionRenders(env.DB, env, 1, render)).toEqual({ processed: 0, failed: 0 });
    expect(render).toHaveBeenCalledOnce();
    expect(await queryAll(env.DB, "SELECT revision,status FROM event_promotion_renders WHERE id=?", job.id)).toEqual([
      { revision: 2, status: "rendered" },
    ]);
    await env.DB.prepare("UPDATE email_outbox SET send_after=? WHERE id=?").bind("2000-01-01T00:00:00.000Z", id).run();
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).attachments).toHaveLength(1);
  });

  it("leaves future mail unchanged without a timer and sends its cached badge once when due", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const registrationId = crypto.randomUUID();
    const manageSecret = newCapabilityLinkSecret();
    const assetsBucket = env.ASSETS_BUCKET;
    if (!assetsBucket) throw new Error("Badge attachment fixture requires ASSETS_BUCKET");
    const get = vi.fn(assetsBucket.get.bind(assetsBucket));
    const mailEnv = { ...env, ASSETS_BUCKET: { ...assetsBucket, get } };
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO registrations (id, event_id, user_id, status, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'test', ?, ?, ?)`,
    )
      .bind(registrationId, eventId, adminId, manageSecret, now, now)
      .run();
    const manageUrl = `https://app.test/manage?token=${queuedCapabilityToken("registration_manage", registrationId)}`;
    const badge = buildBadgeAttachment({ badgeCode: registrationId, badgeType: "attendee", firstName: "Future" });
    const outboxId = await queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "future@example.test",
      messageType: "transactional",
      sendAfterSeconds: 90,
      capabilityLinkValues: [manageUrl],
      data: { firstName: "Future", manageUrl },
      attachments: [badge],
    });
    const readState = () =>
      queryAll(
        env.DB,
        "SELECT status, attempts, send_after, updated_at, sent_at, processing_token, lease_expires_at, payload_json FROM email_outbox WHERE id = ?",
        outboxId,
      );
    const before = await readState();
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 2);
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      await processOutboxById(budgeted.db, mailEnv, outboxId);
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
    expect(budgeted.budget.usedQueries()).toBe(2);
    expect(get).not.toHaveBeenCalled();
    expect(await readState()).toEqual(before);
    expect(await queryAll(env.DB, "SELECT manage_link_secret FROM registrations WHERE id = ?", registrationId)).toEqual(
      [{ manage_link_secret: manageSecret }],
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 0, failed: 0 });
    expect(await processSelectedOutbox(env.DB, env, [outboxId])).toEqual({ processed: 0, failed: 0, skipped: 1 });

    const png = validPngBytes();
    await assetsBucket.put(badge.r2Key, png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { badgeRenderer: badge.renderer! },
    });
    await env.DB.prepare("UPDATE email_outbox SET send_after = ? WHERE id = ?")
      .bind("2000-01-01T00:00:00.000Z", outboxId)
      .run();
    expect(await processPendingOutbox(env.DB, mailEnv, 10)).toEqual({ processed: 1, failed: 0 });
    await processOutboxById(env.DB, env, outboxId);
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(await queryAll(env.DB, "SELECT status, attempts FROM email_outbox WHERE id = ?", outboxId)).toEqual([
      { status: "sent", attempts: 0 },
    ]);
    expect(await queryAll(env.DB, "SELECT manage_link_secret FROM registrations WHERE id = ?", registrationId)).toEqual(
      [{ manage_link_secret: manageSecret }],
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).attachments).toEqual([
      {
        filename: `${badge.filenameBase}.png`,
        type: "image/png",
        disposition: "attachment",
        content: btoa(String.fromCharCode(...png)),
      },
    ]);
  });

  it("sends from the sender the template names, and from the configured sender otherwise", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const named = await createTemplateVersion(env.DB, {
      templateKey: "attendee_invite",
      content: "Hello {{firstName}} from membership",
      subjectTemplate: "From membership",
      fromEmail: "membership@pkic.org",
      fromName: "PKIC Membership",
      createdByUserId: adminId,
    });
    await activateTemplateVersion(env.DB, { templateKey: "attendee_invite", version: named.version });
    await queueN(env.DB, eventId, 1);

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 0 });
    const [, namedInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(namedInit.body)).from).toEqual({ email: "membership@pkic.org", name: "PKIC Membership" });

    // Back to a version with no sender of its own: the configured one again.
    await activateTemplateVersion(env.DB, { templateKey: "attendee_invite", version: 1 });
    await queueN(env.DB, eventId, 1);
    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 0 });
    const [, plainInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(plainInit.body)).from.email).not.toBe("membership@pkic.org");
  });

  it("fails an unsafe template expansion terminally without calling SendGrid", async () => {
    const fetchMock = makeSendgridMock();
    vi.stubGlobal("fetch", fetchMock);
    const unsafe = await createTemplateVersion(env.DB, {
      templateKey: "attendee_invite",
      content: `{{#each items}}${"x".repeat(2_001)}{{/each}}`,
      createdByUserId: adminId,
      subjectTemplate: "Bounded subject",
    });
    await activateTemplateVersion(env.DB, { templateKey: "attendee_invite", version: unsafe.version });
    const outboxId = await queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "unsafe-template@example.test",
      messageType: "transactional",
      data: { items: Array.from({ length: 1_000 }, () => null) },
    });

    expect(await processPendingOutbox(env.DB, env, 10)).toEqual({ processed: 1, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await queryAll<{ attempts: number; status: string; last_error: string }>(
        env.DB,
        "SELECT attempts, status, last_error FROM email_outbox WHERE id = ?",
        outboxId,
      ),
    ).toEqual([
      {
        attempts: 1,
        status: "failed",
        last_error: expect.stringContaining("EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED"),
      },
    ]);
  });

  it("ignores retired uploaded-ICS descriptors without reading R2", async () => {
    const fetchMock = makeSendgridMock();
    const get = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await queueEmail(env.DB, {
      eventId,
      templateKey: "attendee_invite",
      recipientEmail: "legacy-calendar@example.test",
      messageType: "transactional",
      data: { firstName: "Legacy" },
      attachments: [
        {
          kind: "r2-ics-file",
          r2Key: "retired/meeting.ics",
          filename: "meeting.ics",
        },
      ] as never,
    });

    const result = await processPendingOutbox(env.DB, { ...env, ASSETS_BUCKET: { get } } as unknown as Env, 10);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(get).not.toHaveBeenCalled();
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).not.toHaveProperty("attachments");
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

    expect(await resetFailedOutbox(env.DB, [outboxId])).toEqual({ reset: 1, ids: [outboxId] });
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
      outboxId: crypto.randomUUID(),
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
