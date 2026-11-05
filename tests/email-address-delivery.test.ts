import { makeOwnEmailAddressPrimary } from "../functions/_lib/services/own-email-addresses";
import { updateUser } from "../functions/_lib/services/user-management-update";
import { gateNextBatch } from "./helpers/d1-batch-gate";
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
  const result = await env.DB.prepare(
    `SELECT ${emailAddressDeliveryJsonSql("users")} AS evidence FROM users WHERE id=? AND normalized_email=?`,
  )
    .bind(userId, address)
    .first<{ evidence: string }>();
  return decodeEmailAddressDelivery(result?.evidence);
}
async function alias() {
  const id = crypto.randomUUID(),
    address = "delivery.alias@example.test";
  await env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,created_at,verified_at,verification_method)
    VALUES(?,?,?,?,?,?,'magic_link')`)
    .bind(id, userId, address, address, started, started)
    .run();
  return { id, address };
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
  it("accepts an asynchronous bounce correlated by outbox id without a provider message id", async () => {
    const id = await message();
    await event(id, { sg_message_id: undefined, outbox_id: id });
    expect((await delivery()).status).toBe("bouncing");
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
  it("survives deletion of message and audit history", async () => {
    const id = await message();
    await event(id);
    await env.DB.batch([env.DB.prepare("DELETE FROM audit_log"), env.DB.prepare("DELETE FROM email_outbox")]);
    expect(await delivery()).toEqual({ status: "bouncing", observedAt: started });
    expect((await readOwnEmailAddress(env.DB, userId, null)).delivery.status).toBe("bouncing");
  });
  it("records recipient-only events after outbox cleanup, including additional addresses", async () => {
    const added = await alias();
    await event("gone", { sg_message_id: undefined, email: added.address });
    expect((await readOwnEmailAddress(env.DB, userId, added.id)).delivery.status).toBe("bouncing");
    expect((await delivery()).status).toBe("unknown");
    await event("gone", { sg_message_id: undefined });
    expect((await delivery()).status).toBe("bouncing");
  });
  it("records a BCC account address without changing the primary recipient's status", async () => {
    const added = await alias(),
      id = await message();
    await event(id, { email: added.address });
    expect((await readOwnEmailAddress(env.DB, userId, added.id)).delivery.status).toBe("bouncing");
    expect((await delivery()).status).toBe("unknown");
  });
  it("preserves both addresses' state when making an additional address primary", async () => {
    const added = await alias();
    await event("gone", { event: "delivered" });
    await event("gone", { email: added.address });
    const primary = await makeOwnEmailAddressPrimary(env.DB, { userId, emailId: added.id });
    expect(primary.email).toBe(added.address);
    expect(primary.delivery.status).toBe("bouncing");
    const demoted = await readOwnEmailAddress(env.DB, userId, added.id);
    expect(demoted.email).toBe(email);
    expect(demoted.delivery.status).toBe("delivered");
  });
  it("does not overwrite a webhook that races with a primary-address swap", async () => {
    const added = await alias();
    const raced = gateNextBatch(env.DB);
    const change = makeOwnEmailAddressPrimary(raced.db, { userId, emailId: added.id });
    const refused = change.catch((error: unknown) => error);
    await raced.reached;
    await event("gone", { email: added.address });
    raced.release();
    expect(await refused).toMatchObject({ code: "USER_LIFECYCLE_CHANGED" });
    expect((await readOwnEmailAddress(env.DB, userId, added.id)).delivery.status).toBe("bouncing");
    expect((await readOwnEmailAddress(env.DB, userId, null)).email).toBe(email);
  });
  it("transfers additional-address delivery state during a staff correction", async () => {
    const added = await alias(),
      { admin } = await seedEventAndAdmin(env.DB);
    await event("gone", { email: added.address });
    await updateUser(env.DB, admin, userId, { email: added.address });
    expect((await readOwnEmailAddress(env.DB, userId, null)).delivery.status).toBe("bouncing");
    await updateUser(env.DB, admin, userId, { email: "corrected@example.test" });
    expect((await readOwnEmailAddress(env.DB, userId, null)).delivery.status).toBe("unknown");
  });
  it("refuses a staff promotion when delivery state changes after its preflight", async () => {
    const added = await alias(),
      { admin } = await seedEventAndAdmin(env.DB),
      raced = gateNextBatch(env.DB);
    const change = updateUser(raced.db, admin, userId, { email: added.address }).catch((error: unknown) => error);
    await raced.reached;
    await event("gone", { email: added.address });
    raced.release();
    expect(await change).toMatchObject({ code: "USER_UPDATE_CONFLICT" });
    expect((await readOwnEmailAddress(env.DB, userId, null)).email).toBe(email);
    expect((await readOwnEmailAddress(env.DB, userId, added.id)).delivery.status).toBe("bouncing");
  });
  it("retains every signal needed to handle transient outcomes arriving before older hard failures", async () => {
    await event("gone", { event: "delivered", timestamp: timestamp + 10 });
    await event("gone", { type: "blocked", timestamp: timestamp + 30 });
    await event("gone", { type: "bounce", timestamp: timestamp + 20 });
    expect((await delivery()).status).toBe("bouncing");
    await event("gone", { event: "delivered", timestamp: timestamp + 25 });
    expect((await delivery()).status).toBe("delayed");
    await event("gone", { event: "delivered", timestamp: timestamp + 40 });
    expect((await delivery()).status).toBe("delivered");
  });
  it("reads a populated user page from account records in one bounded batch", async () => {
    for (let i = 0; i < 8; i++) {
      const address = `delivery-page-${i}@example.test`,
        owner = await insertUser(env.DB, address);
      await event("gone", { email: address });
      expect(owner).toBeTruthy();
    }
    const flow = profileD1Flow(env.DB, { measurePayloadBytes: true });
    const result = await listUsers(flow.db, usersListQuerySchema.parse({ q: "delivery-page-", limit: 8 }));
    expect(result.users).toHaveLength(8);
    expect(result.users.every((user) => user.emailDelivery.status === "bouncing")).toBe(true);
    const profile = await flow.report();
    expect(profile.roundTrips).toBe(1);
    expect(profile.statements).toBe(2);
    expect(Math.max(...profile.queries.map((query) => query.resultBytes ?? 0))).toBeLessThan(32 * 1024);
    expect(profile.plans.some((plan) => plan.sql.includes("email_outbox"))).toBe(false);
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
