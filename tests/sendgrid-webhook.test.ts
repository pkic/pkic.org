import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import type { Env } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";

function executionContext(): ExecutionContext {
  return { passThroughOnException: () => {}, waitUntil: () => {} } as unknown as ExecutionContext;
}

async function callWebhook(environment: Env, body: string, headers: HeadersInit = {}): Promise<Response> {
  return app.fetch(
    new Request("https://pkic.org/api/v1/webhooks/sendgrid", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    environment as any,
    executionContext(),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function p1363ToDer(signature: Uint8Array): Uint8Array {
  const encodeInteger = (value: Uint8Array): Uint8Array => {
    let offset = 0;
    while (offset < value.length - 1 && value[offset] === 0) offset += 1;
    const trimmed = value.subarray(offset);
    const needsLeadingZero = (trimmed[0] & 0x80) !== 0;
    const encoded = new Uint8Array(2 + trimmed.length + (needsLeadingZero ? 1 : 0));
    encoded[0] = 0x02;
    encoded[1] = trimmed.length + (needsLeadingZero ? 1 : 0);
    encoded.set(trimmed, needsLeadingZero ? 3 : 2);
    return encoded;
  };
  const r = encodeInteger(signature.subarray(0, 32));
  const s = encodeInteger(signature.subarray(32, 64));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function signedWebhook(
  body: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
): Promise<{ key: string; signature: string; timestamp: string }> {
  const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(timestamp + body),
    ),
  );
  const derSignature = rawSignature.length === 64 ? p1363ToDer(rawSignature) : rawSignature;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  return { key: bytesToBase64(publicKey), signature: bytesToBase64(derSignature), timestamp };
}

async function seedSentOutbox(providerMessageId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_outbox
       (id, template_key, recipient_email, message_type, subject, payload_json, provider, provider_message_id,
        status, attempts, send_after, last_error, created_at, updated_at, sent_at)
     VALUES (?, 'test', 'recipient@example.test', 'transactional', 'Test', '{}', 'sendgrid', ?,
             'sent', 1, datetime('now'), NULL, datetime('now'), datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), providerMessageId)
    .run();
}

describe("SendGrid event webhook security", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("fails closed outside local development when the verification key is absent", async () => {
    const response = await callWebhook(
      { ...env, APP_BASE_URL: "https://pkic.org", SENDGRID_WEBHOOK_VERIFICATION_KEY: undefined } as Env,
      JSON.stringify([{ event: "delivered", sg_message_id: "forged", env_url: "https://pkic.org" }]),
    );

    expect(response.status).toBe(503);
  });

  it("rejects a missing or invalid signature without changing delivery state", async () => {
    await seedSentOutbox("message-1");
    const body = JSON.stringify([
      { event: "delivered", sg_message_id: "message-1.filter0", env_url: "https://pkic.org" },
    ]);
    const { key, timestamp } = await signedWebhook(body);

    const missing = await callWebhook(
      { ...env, APP_BASE_URL: "https://pkic.org", SENDGRID_WEBHOOK_VERIFICATION_KEY: key } as Env,
      body,
    );
    const invalid = await callWebhook(
      { ...env, APP_BASE_URL: "https://pkic.org", SENDGRID_WEBHOOK_VERIFICATION_KEY: key } as Env,
      body,
      {
        "X-Twilio-Email-Event-Webhook-Signature": bytesToBase64(new Uint8Array([1, 2, 3])),
        "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
      },
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(403);
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM email_outbox WHERE provider_message_id = 'message-1'",
      ),
    ).toEqual([{ status: "sent" }]);
  });

  it("accepts a valid signature and processes only an exact environment match", async () => {
    await seedSentOutbox("message-2");
    await seedSentOutbox("message-3");
    const matchingBody = JSON.stringify([
      { event: "delivered", sg_message_id: "message-2.filter0", env_url: "https://pkic.org" },
    ]);
    const matchingSignature = await signedWebhook(matchingBody);
    const configuredEnv = {
      ...env,
      APP_BASE_URL: "https://pkic.org",
      SENDGRID_WEBHOOK_VERIFICATION_KEY: matchingSignature.key,
    } as Env;

    const matching = await callWebhook(configuredEnv, matchingBody, {
      "X-Twilio-Email-Event-Webhook-Signature": matchingSignature.signature,
      "X-Twilio-Email-Event-Webhook-Timestamp": matchingSignature.timestamp,
    });

    const missingEnvironmentBody = JSON.stringify([{ event: "delivered", sg_message_id: "message-3.filter0" }]);
    const missingEnvironmentSignature = await signedWebhook(missingEnvironmentBody);
    const missingEnvironment = await callWebhook(
      { ...configuredEnv, SENDGRID_WEBHOOK_VERIFICATION_KEY: missingEnvironmentSignature.key },
      missingEnvironmentBody,
      {
        "X-Twilio-Email-Event-Webhook-Signature": missingEnvironmentSignature.signature,
        "X-Twilio-Email-Event-Webhook-Timestamp": missingEnvironmentSignature.timestamp,
      },
    );

    expect(matching.status).toBe(200);
    expect(missingEnvironment.status).toBe(200);
    expect(
      await queryAll<{ provider_message_id: string; status: string }>(
        env.DB,
        "SELECT provider_message_id, status FROM email_outbox WHERE provider_message_id IN ('message-2', 'message-3') ORDER BY provider_message_id",
      ),
    ).toEqual([
      { provider_message_id: "message-2", status: "delivered" },
      { provider_message_id: "message-3", status: "sent" },
    ]);
  });

  it("allows unsigned local-development events", async () => {
    await seedSentOutbox("local-message");
    const response = await callWebhook(
      { ...env, APP_BASE_URL: "http://localhost:8788", SENDGRID_WEBHOOK_VERIFICATION_KEY: undefined } as Env,
      JSON.stringify([{ event: "delivered", sg_message_id: "local-message.filter0" }]),
    );

    expect(response.status).toBe(200);
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM email_outbox WHERE provider_message_id = 'local-message'",
      ),
    ).toEqual([{ status: "delivered" }]);
  });

  it("rejects an otherwise-valid signature outside SendGrid's retry window", async () => {
    const body = JSON.stringify([{ event: "delivered", sg_message_id: "stale.filter0", env_url: "https://pkic.org" }]);
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 26 * 60 * 60);
    const signed = await signedWebhook(body, staleTimestamp);

    const response = await callWebhook(
      { ...env, APP_BASE_URL: "https://pkic.org", SENDGRID_WEBHOOK_VERIFICATION_KEY: signed.key } as Env,
      body,
      {
        "X-Twilio-Email-Event-Webhook-Signature": signed.signature,
        "X-Twilio-Email-Event-Webhook-Timestamp": signed.timestamp,
      },
    );

    expect(response.status).toBe(403);
  });

  it("processes bounce and unsubscribe effects atomically and idempotently across webhook replay", async () => {
    await seedSentOutbox("message-replay");
    const body = JSON.stringify([
      {
        event: "spamreport",
        sg_event_id: "event-replay-1",
        sg_message_id: "message-replay.filter0",
        email: "Recipient@Example.Test",
      },
    ]);
    const environment = {
      ...env,
      APP_BASE_URL: "http://localhost:8788",
      SENDGRID_WEBHOOK_VERIFICATION_KEY: undefined,
    } as Env;

    expect((await callWebhook(environment, body)).status).toBe(200);
    expect((await callWebhook(environment, body)).status).toBe(200);

    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox WHERE provider_message_id = ?", [
        "message-replay",
      ]),
    ).toEqual([{ status: "bounced" }]);
    expect(
      await queryAll<{ email: string; channel: string }>(
        env.DB,
        "SELECT email, channel FROM unsubscribes WHERE email = 'recipient@example.test'",
      ),
    ).toEqual([{ email: "recipient@example.test", channel: "email" }]);
    expect(
      await queryAll<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) AS count FROM audit_log WHERE idempotency_key = 'sendgrid:event-replay-1'",
      ),
    ).toEqual([{ count: 1 }]);
  });
});
