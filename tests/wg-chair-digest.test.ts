import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { processPendingOutbox } from "../functions/_lib/email/outbox";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import {
  queueWeeklyWgChairDigest,
  resolveWgChairDigestWindow,
  runWeeklyWgChairDigest,
} from "../functions/_lib/services/wg-chair-digest";
import type { Env } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const env = workerEnv as unknown as Env;
const RUN_AT = new Date("2026-08-10T08:05:00.000Z");
const NEXT_RUN_AT = new Date("2026-08-17T08:05:00.000Z");
const WINDOW_JOIN = "2026-08-05T10:00:00.000Z";
const WINDOW_LEAVE = "2026-08-07T10:00:00.000Z";
const NEXT_WINDOW_JOIN = "2026-08-12T10:00:00.000Z";
const STALE_CHANGE = "2026-08-02T10:00:00.000Z";

async function insertWorkingGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, name, slug)
    .run();
  return id;
}

async function insertWorkingGroups(count: number): Promise<void> {
  const groups = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `AAA Quiet ${String(index).padStart(3, "0")}`,
    slug: `aaa-quiet-${index}`,
  }));
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     SELECT json_extract(value, '$.id'), 'working_group', json_extract(value, '$.name'),
            json_extract(value, '$.slug'), 1, datetime('now'), datetime('now')
       FROM json_each(?)`,
  )
    .bind(JSON.stringify(groups))
    .run();
}

async function insertUser(email: string, notificationPreferencesJson: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (
       id, email, normalized_email, first_name, last_name,
       notification_preferences_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email.toLowerCase(), "First", "Last", notificationPreferencesJson)
    .run();
  return id;
}

async function assignLeadership(
  userId: string,
  workingGroupId: string,
  roleId: "role-group_lead" | "role-group_deputy_lead",
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, created_at)
     VALUES (?, ?, ?, 'group', ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, roleId, workingGroupId)
    .run();
}

async function insertMembership(
  workingGroupId: string,
  userId: string,
  joinedAt: string,
  leftAt: string | null = null,
): Promise<void> {
  const memberId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
     VALUES (?, 'individual', ?, 'active', ?, ?)`,
  )
    .bind(memberId, userId, joinedAt, joinedAt)
    .run();
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, member_id, source, joined_at, left_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'staff', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), workingGroupId, userId, memberId, joinedAt, leftAt, joinedAt, joinedAt)
    .run();
}

async function seedTemplate(
  createdByUserId: string,
  templateKey: string,
  content: string,
  subjectTemplate: string,
): Promise<void> {
  const version = await createTemplateVersion(env.DB, {
    templateKey,
    content,
    createdByUserId,
    subjectTemplate,
  });
  await activateTemplateVersion(env.DB, { templateKey, version: version.version });
}

async function seedDigestTemplates(createdByUserId: string): Promise<void> {
  await seedTemplate(createdByUserId, "email_layout", "{{{body_html}}}", "Email layout");
  await seedTemplate(
    createdByUserId,
    "wg-chair-membership-digest",
    "Membership digest for {{workingGroupName}}",
    "{{workingGroupName}} membership update",
  );
}

async function readDigestOutbox(): Promise<
  Array<{
    id: string;
    recipient_email: string;
    payload_json: string;
    status: string;
    attempts: number;
    idempotency_key: string;
    last_error: string | null;
  }>
> {
  return queryAll(
    env.DB,
    `SELECT id, recipient_email, payload_json, status, attempts, idempotency_key, last_error
       FROM email_outbox
      WHERE template_key = 'wg-chair-membership-digest'
      ORDER BY created_at, id`,
  );
}

describe("weekly WG chair membership-change digest", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the most recently closed Monday 08:00 UTC window", () => {
    expect(resolveWgChairDigestWindow(new Date("2026-08-10T07:59:59.999Z"))).toEqual({
      start: "2026-07-27T08:00:00.000Z",
      end: "2026-08-03T08:00:00.000Z",
      key: "2026-08-03T08:00:00.000Z",
    });
    expect(resolveWgChairDigestWindow(new Date("2026-08-10T08:00:00.000Z"))).toEqual({
      start: "2026-08-03T08:00:00.000Z",
      end: "2026-08-10T08:00:00.000Z",
      key: "2026-08-10T08:00:00.000Z",
    });
  });

  it("finds a changed group beyond the former 200-row UI page in three D1 queries", async () => {
    await insertWorkingGroups(201);
    const changedGroupId = await insertWorkingGroup("ZZZ Changed", "zzz-changed");
    const chairId = await insertUser("chair@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(chairId, changedGroupId, "role-group_lead");
    await insertMembership(changedGroupId, joinerId, WINDOW_JOIN);

    const budgeted = createD1QueryBudgetedDatabase(env.DB, 3);
    const result = await queueWeeklyWgChairDigest(budgeted.db, RUN_AT);

    expect(result).toMatchObject({ workingGroupsWithChanges: 1, emailsSent: 1 });
    expect(budgeted.budget.usedQueries()).toBe(3);
    expect(await readDigestOutbox()).toHaveLength(1);
  });

  it("applies opt-out in SQL while still including an eligible vice chair", async () => {
    const workingGroupId = await insertWorkingGroup("Opt-out WG", "opt-out-wg");
    const chairId = await insertUser(
      "opted-out-chair@example.test",
      JSON.stringify({ wgChairMembershipDigest: false }),
    );
    const viceChairId = await insertUser("vice-chair@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await assignLeadership(viceChairId, workingGroupId, "role-group_deputy_lead");
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);

    const result = await queueWeeklyWgChairDigest(env.DB, RUN_AT);
    const outbox = await readDigestOutbox();

    expect(result.emailsSent).toBe(1);
    expect(outbox.map((row) => row.recipient_email)).toEqual(["vice-chair@example.test"]);
  });

  it("deduplicates a person who is both current chair and vice chair", async () => {
    const workingGroupId = await insertWorkingGroup("Dual-role WG", "dual-role-wg");
    const leaderId = await insertUser("leader@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(leaderId, workingGroupId, "role-group_lead");
    await assignLeadership(leaderId, workingGroupId, "role-group_deputy_lead");
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);

    const result = await queueWeeklyWgChairDigest(env.DB, RUN_AT);
    const outbox = await readDigestOutbox();
    const payload = JSON.parse(outbox[0].payload_json) as { recipientRole: string };

    expect(result.emailsSent).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(payload.recipientRole).toBe("chair");
  });

  it("shapes join and leave events independently and excludes stale changes", async () => {
    const workingGroupId = await insertWorkingGroup("Busy WG", "busy-wg");
    const chairId = await insertUser("chair@example.test");
    const moverId = await insertUser("mover@example.test");
    const staleId = await insertUser("stale@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await insertMembership(workingGroupId, moverId, WINDOW_JOIN, WINDOW_LEAVE);
    await insertMembership(workingGroupId, staleId, STALE_CHANGE, null);

    await queueWeeklyWgChairDigest(env.DB, RUN_AT);
    const outbox = await readDigestOutbox();
    const payload = JSON.parse(outbox[0].payload_json) as {
      joined: Array<{ name: string }>;
      left: Array<{ name: string }>;
      windowStart: string;
      windowEnd: string;
    };

    expect(payload.joined).toEqual([{ name: "First Last", organizationName: null }]);
    expect(payload.left).toEqual([{ name: "First Last", organizationName: null }]);
    expect(payload.windowStart).toBe("2026-08-03T08:00:00.000Z");
    expect(payload.windowEnd).toBe("2026-08-10T08:00:00.000Z");
  });

  it("does not insert a duplicate when the same weekly window is retried", async () => {
    const workingGroupId = await insertWorkingGroup("Retry WG", "retry-wg");
    const chairId = await insertUser("chair@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);

    const first = await queueWeeklyWgChairDigest(env.DB, RUN_AT);
    const retry = await queueWeeklyWgChairDigest(env.DB, new Date("2026-08-11T12:00:00.000Z"));
    const outbox = await readDigestOutbox();

    expect(first.emailsSent).toBe(1);
    expect(retry.emailsSent).toBe(0);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].idempotency_key).toContain("2026-08-10T08:00:00.000Z");
  });

  it("delivers again for a new weekly window", async () => {
    const workingGroupId = await insertWorkingGroup("Weekly WG", "weekly-wg");
    const chairId = await insertUser("chair@example.test");
    const firstJoinerId = await insertUser("first-joiner@example.test");
    const secondJoinerId = await insertUser("second-joiner@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await seedDigestTemplates(chairId);
    await insertMembership(workingGroupId, firstJoinerId, WINDOW_JOIN);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const deliveryEnv = {
      ...env,
      APP_BASE_URL: "https://pkic.example.test",
      SENDGRID_API_KEY: "test-key",
    } as Env;

    const first = await runWeeklyWgChairDigest(env.DB, deliveryEnv, RUN_AT);
    await insertMembership(workingGroupId, secondJoinerId, NEXT_WINDOW_JOIN);
    const second = await runWeeklyWgChairDigest(env.DB, deliveryEnv, NEXT_RUN_AT);

    expect(first.emailsSent).toBe(1);
    expect(second.emailsSent).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await readDigestOutbox()).map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  it("bounds immediate delivery and leaves the remainder for the durable outbox processor", async () => {
    const workingGroupId = await insertWorkingGroup("Bounded WG", "bounded-wg");
    const chairId = await insertUser("chair@example.test");
    const viceChairId = await insertUser("vice-chair@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await assignLeadership(viceChairId, workingGroupId, "role-group_deputy_lead");
    await seedDigestTemplates(chairId);
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const deliveryEnv = {
      ...env,
      APP_BASE_URL: "https://pkic.example.test",
      SENDGRID_API_KEY: "test-key",
      SCHEDULED_OUTBOX_LIMIT: "1",
    } as Env;

    const result = await runWeeklyWgChairDigest(env.DB, deliveryEnv, RUN_AT);

    expect(result.emailsSent).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readDigestOutbox()).map((row) => row.status).sort()).toEqual(["queued", "sent"]);

    await processPendingOutbox(env.DB, deliveryEnv, 20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await readDigestOutbox()).map((row) => row.status)).toEqual(["sent", "sent"]);
  });

  it("keeps a failed delivery durable and retryable without duplicating it", async () => {
    const workingGroupId = await insertWorkingGroup("Durable WG", "durable-wg");
    const chairId = await insertUser("chair@example.test");
    const joinerId = await insertUser("joiner@example.test");
    await assignLeadership(chairId, workingGroupId, "role-group_lead");
    await seedDigestTemplates(chairId);
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const deliveryEnv = {
      ...env,
      APP_BASE_URL: "https://pkic.example.test",
      SENDGRID_API_KEY: "test-key",
    } as Env;

    const result = await runWeeklyWgChairDigest(env.DB, deliveryEnv, RUN_AT);
    const retry = await queueWeeklyWgChairDigest(env.DB, RUN_AT);
    const outbox = await readDigestOutbox();

    expect(result.emailsSent).toBe(1);
    expect(retry.emailsSent).toBe(0);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ status: "retrying", attempts: 1 });
    expect(outbox[0].last_error).toContain("SENDGRID_SEND_FAILED");
  });

  it("counts a changed chairless group without creating an outbox row", async () => {
    const workingGroupId = await insertWorkingGroup("Chairless WG", "chairless-wg");
    const joinerId = await insertUser("joiner@example.test");
    await insertMembership(workingGroupId, joinerId, WINDOW_JOIN);

    const result = await queueWeeklyWgChairDigest(env.DB, RUN_AT);

    expect(result).toMatchObject({ workingGroupsWithChanges: 1, emailsSent: 0 });
    expect(await readDigestOutbox()).toHaveLength(0);
  });
});
