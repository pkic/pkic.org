import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { listUsers } from "../functions/_lib/services/user-management-list";
import { usersListQuerySchema } from "../assets/shared/schemas/user-management";
import { resetDb } from "./helpers/reset-db";
import { insertUser } from "./helpers/membership";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";

import { processSendgridEvents } from "../functions/_lib/services/sendgrid-webhook/processing";
import {
  emailAddressDeliveryJsonSql,
  decodeEmailAddressDelivery,
} from "../functions/_lib/services/email-address-delivery";
import { readOwnEmailAddress } from "../functions/_lib/services/own-email-address-read";
import { usersListResponseSchema, userDetailResponseSchema } from "../assets/shared/schemas/user-management";

import type { SendgridEvent } from "../assets/shared/schemas/email-webhook";

const email = "delivery.owner@example.test";
const started = "2026-11-01T10:00:00.000Z";
const timestamp = Date.parse(started) / 1000;
let userId: string;
beforeEach(async () => {
  await resetDb();
  userId = await insertUser(env.DB, email);
});

async function message(address = email, owner: string | null = userId, status = "sent") {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO email_outbox
    (id,template_key,recipient_user_id,recipient_email,message_type,subject,payload_json,provider,provider_message_id,status,send_after,created_at,updated_at)
    VALUES (?,'test',?,?,'transactional','Delivery test','{}','sendgrid',?,?,?, ?,?)`)
    .bind(id, owner, address, id, status, started, started, started)
    .run();
  return id;
}
async function event(id: string, values: Partial<SendgridEvent> = {}) {
  await processSendgridEvents(env, [
    {
      event: "bounce",
      type: "bounce",
      email,
      sg_message_id: id,
      sg_event_id: crypto.randomUUID(),
      timestamp,
      env_url: env.APP_BASE_URL,
      ...values,
    },
  ]);
}
async function delivery(address = email) {
  const result = await env.DB.prepare(`SELECT ${emailAddressDeliveryJsonSql("?", "?")} AS evidence`)
    // The address history is selected once and shared by both evidence sources.
    .bind(address, userId)
    .first<{ evidence: string }>();
  return decodeEmailAddressDelivery(result?.evidence);
}

describe("address delivery evidence", () => {
  it("reports unknown until a delivery outcome is observed", async () => {
    await message(email, userId, "queued");
    expect(await delivery()).toEqual({ status: "unknown", observedAt: null });
  });
  it("keeps a hard bounce across queued sends, processed events and temporary failures", async () => {
    const id = await message();
    await event(id);
    const retry = await message();
    await event(retry, { event: "processed", timestamp: timestamp + 1 });
    await event(retry, { type: "blocked", timestamp: timestamp + 2 });
    expect(await delivery()).toEqual({ status: "bouncing", observedAt: started });
  });
  it("uses event time across messages and clears the warning only after later delivery", async () => {
    const failed = await message(),
      successful = await message();
    await event(successful, { event: "delivered", timestamp: timestamp + 20 });
    await event(failed, { timestamp: timestamp + 10 }); // Old webhook arrives last.
    expect(await delivery()).toEqual({ status: "delivered", observedAt: "2026-11-01T10:00:20.000Z" });
    await event(failed, { timestamp: timestamp + 30 });
    expect((await delivery()).status).toBe("bouncing");
    await event(successful, { event: "delivered", timestamp: timestamp + 40 });
    expect((await delivery()).status).toBe("delivered");
  });
  it.each(["blocked", "soft"])("treats %s bounce events as temporary", async (type) => {
    const id = await message();
    await event(id, { type });
    expect((await delivery()).status).toBe("delayed");
    expect(await env.DB.prepare("SELECT status FROM email_outbox WHERE id=?").bind(id).first("status")).toBe("sent");
  });
  it.each([
    { event: "dropped", reason: "Bounced Address", status: "bouncing" },
    { event: "dropped", reason: "Unsubscribed Address", status: "blocked" },
    { event: "spamreport", reason: "spam", status: "blocked" },
  ])(
    "classifies $event/$reason without confusing a block with an invalid mailbox",
    async ({ event: kind, reason, status }) => {
      const id = await message();
      await event(id, { event: kind, reason });
      expect((await delivery()).status).toBe(status);
    },
  );
  it("does not apply an old address's bounce to a new primary or another owner", async () => {
    const id = await message();
    await event(id);
    const other = await insertUser(env.DB, "different.owner@example.test");
    const otherId = await message("new.address@example.test", other);
    await event(otherId, { email: "new.address@example.test" });
    expect((await delivery("new.address@example.test")).status).toBe("unknown");
    await env.DB.prepare(
      "UPDATE users SET email='replacement@example.test',normalized_email='replacement@example.test' WHERE id=?",
    )
      .bind(userId)
      .run();
    expect((await readOwnEmailAddress(env.DB, userId, null)).delivery.status).toBe("unknown");
  });
  it("ignores BCC outcomes for primary-address status and the primary message state", async () => {
    const id = await message();
    await event(id, { email: "bcc@example.test" });
    expect((await delivery()).status).toBe("unknown");
    expect(await env.DB.prepare("SELECT status FROM email_outbox WHERE id=?").bind(id).first("status")).toBe("sent");
  });
  it("does not erase legacy primary delivery evidence when a BCC recipient bounces", async () => {
    const id = await message(email, userId, "delivered");
    await event(id, { email: "bcc@example.test" });
    expect((await delivery()).status).toBe("delivered");
  });
  it("does not let a BCC update advance a legacy delivery timestamp and clear a later bounce", async () => {
    const legacy = await message(email, userId, "delivered"),
      failed = await message();
    await event(failed, { timestamp: timestamp + 1 });
    await event(legacy, { email: "bcc@example.test", timestamp: timestamp + 2 });
    expect((await delivery()).status).toBe("bouncing");
    expect(
      await env.DB.prepare("SELECT updated_at FROM email_outbox WHERE id=?").bind(legacy).first("updated_at"),
    ).toBe(started);
  });
  it("accepts an asynchronous bounce correlated by outbox id without a provider message id", async () => {
    const id = await message();
    await event(id, { sg_message_id: undefined, outbox_id: id });
    expect((await delivery()).status).toBe("bouncing");
  });
  it("projects legacy delivery outcomes with no provider-event audit and no copied user id", async () => {
    await message(email, null, "bounced");
    expect(await delivery()).toEqual({ status: "bouncing", observedAt: started });
  });
  it("retains a legacy primary bounce when only its BCC recipient reports delivery", async () => {
    const legacy = await message(email, userId, "bounced");
    await event(legacy, { event: "delivered", email: "bcc@example.test", timestamp: timestamp + 10 });
    expect((await delivery()).status).toBe("bouncing");
    expect(
      await env.DB.prepare("SELECT updated_at FROM email_outbox WHERE id=?").bind(legacy).first("updated_at"),
    ).toBe(started);
  });
  it("preserves legacy evidence in the same bounded webhook batch", async () => {
    const legacy = await message(email, userId, "delivered");
    const flow = profileD1Flow(env.DB, { measurePayloadBytes: true });
    await processSendgridEvents({ ...env, DB: flow.db as typeof env.DB }, [
      {
        event: "processed",
        email,
        sg_message_id: legacy,
        sg_event_id: "legacy-batch-proof",
        timestamp,
        env_url: env.APP_BASE_URL,
      },
    ]);
    const profile = await flow.report();
    expect(profile.roundTrips).toBe(1);
    expect(Math.max(...profile.queries.map((query) => query.requestBytes ?? 0))).toBeLessThan(64 * 1024);
    const legacyPlan = profile.plans.find((plan) => plan.sql.includes("email:legacy-outcome:"));
    expect(legacyPlan).toBeDefined();
    expect(JSON.stringify(legacyPlan?.plan)).not.toContain("SCAN email_outbox");
  });
  it("does not let late acceptance falsely recover a legacy delivery after a newer bounce", async () => {
    const legacy = await message(email, userId, "delivered"),
      failed = await message();
    await event(failed, { timestamp: timestamp + 10 });
    await event(legacy, { event: "processed", timestamp: timestamp - 10 });
    expect((await delivery()).status).toBe("bouncing");
    expect(
      await env.DB.prepare("SELECT updated_at FROM email_outbox WHERE id=?").bind(legacy).first("updated_at"),
    ).toBe(started);
  });
  it("retains a legacy hard bounce through temporary failures and webhook replay", async () => {
    const legacy = await message(email, userId, "bounced");
    await event(legacy, { type: "blocked", timestamp: timestamp + 10 });
    await event(legacy, { event: "processed", timestamp: timestamp + 20 });
    expect((await delivery()).status).toBe("bouncing");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE idempotency_key=?")
        .bind(`email:legacy-outcome:${legacy}`)
        .first("count"),
    ).toBe(1);
  });
  it("preserves a newer legacy delivery when its first received bounce is older", async () => {
    const legacy = await message(email, userId, "delivered");
    await event(legacy, { timestamp: timestamp - 10 });
    expect(await delivery()).toEqual({ status: "delivered", observedAt: started });
  });
  it("does not relabel a legacy spam report as an invalid mailbox", async () => {
    const id = await message(email, userId, "bounced");
    await env.DB.prepare("UPDATE email_outbox SET last_error='Spam report received' WHERE id=?").bind(id).run();
    expect((await delivery()).status).toBe("blocked");
  });
  it("keeps primary and secondary addresses independent in the address read model", async () => {
    const alias = "delivery.alias@example.test",
      aliasId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES (?,?,?,?,?)")
      .bind(aliasId, userId, alias, alias, started)
      .run();
    const id = await message(alias);
    await event(id, { email: alias });
    expect((await readOwnEmailAddress(env.DB, userId, aliasId)).delivery.status).toBe("bouncing");
    expect((await readOwnEmailAddress(env.DB, userId, null)).delivery.status).toBe("unknown");
  });
  it("uses address and audit indexes for both historical sources", async () => {
    const result = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT ${emailAddressDeliveryJsonSql("users.id", "users.email")} FROM users WHERE id=?`,
    )
      .bind(userId)
      .all<{ detail: string }>();
    const plan = result.results.map((row) => row.detail).join("\n");
    expect(plan).toContain("idx_email_outbox_recipient_address");
    expect(plan).toContain("idx_audit_log_entity");
    expect(plan).not.toMatch(/SCAN evidence/);
  });
  it("keeps a populated user page in one bounded database batch", async () => {
    for (let i = 0; i < 8; i++) {
      const address = `history-${i}@example.test`;
      const owner = await insertUser(env.DB, address);
      const statements = Array.from({ length: 12 }, () =>
        env.DB.prepare(`INSERT INTO email_outbox
        (id,template_key,recipient_user_id,recipient_email,message_type,subject,payload_json,provider,status,send_after,created_at,updated_at)
        VALUES (?,'test',?,?,'transactional','Test','{}','sendgrid','bounced',?,?,?)`).bind(
          crypto.randomUUID(),
          owner,
          address,
          started,
          started,
          started,
        ),
      );
      await env.DB.batch(statements);
    }
    const flow = profileD1Flow(env.DB, { measurePayloadBytes: true });
    const result = await listUsers(flow.db, usersListQuerySchema.parse({ q: "history-", limit: 8 }));
    expect(result.users).toHaveLength(8);
    expect(result.users.every((user) => user.emailDelivery.status === "bouncing")).toBe(true);
    const profile = await flow.report();
    expect(profile.roundTrips).toBe(1);
    expect(profile.statements).toBe(2);
    expect(Math.max(...profile.queries.map((query) => query.requestBytes ?? 0))).toBeLessThan(64 * 1024);
    expect(Math.max(...profile.queries.map((query) => query.resultBytes ?? 0))).toBeLessThan(32 * 1024);
  });
  it("exposes the status through mounted user APIs without an extra users-list round trip", async () => {
    const { admin } = await seedEventAndAdmin(env.DB);
    const token = await createAdminSession(env.DB, admin.id, "delivery-status-admin");
    const headers = { authorization: `Bearer ${token}` };
    const id = await message();
    await event(id);
    const response = await callApi(env, `/api/v1/users?q=${email}`, { headers }, { maxRoundTrips: 1 });
    expect(response.status).toBe(200);
    const page = usersListResponseSchema.parse(await response.json());
    expect(page.users[0].emailDelivery.status).toBe("bouncing");
    const detail = await callApi(env, `/api/v1/users/${userId}`, { headers });
    expect(detail.status).toBe(200);
    expect(userDetailResponseSchema.parse(await detail.json()).user.emailDelivery.status).toBe("bouncing");
  });
});
